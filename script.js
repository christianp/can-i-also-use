import { createApp } from './vue.esm-browser.js'

let caniuse_data;
let mdn_data;

const mdn_caniuse_browser_map = {
  "chrome": "chrome",
  "chrome_android": "and_chr",
  "edge": "edge",
  "firefox": "firefox",
  "firefox_android": "and_ff",
  "ie": "ie",
  "opera": "opera",
  "opera_android": "op_mob",
  "safari": "safari",
  "safari_ios": "ios_saf",
  "samsunginternet_android": "samsung",
};

let total_observable = 0;

async function load_data() {
    const r1 = await fetch('data.caniuse.json');
    caniuse_data = await r1.json();
    window.caniuse_data = caniuse_data;

    const r2 = await fetch('data.mdn.json');
    mdn_data = await r2.json();
    window.mdn_data = mdn_data;

    for(let agent of Object.values(mdn_caniuse_browser_map)) {
        for(let s of Object.values(caniuse_data.agents[agent].usage_global)) {
            total_observable += s;
        }
    }
    console.log(total_observable);

    window.features = Array.from(find_features(mdn_data)).map(({name, compat}) => new Feature(name, compat));

    return {caniuse_data, mdn_data, features};
}

function* find_features(data, prefix='') {
    for(let [k,d] of Object.entries(data)) {
        if(k.startsWith('__') || k=='browsers') {
            continue;
        }
        const name = `${prefix} ${k}`;
        if(d['__compat']) {
            yield {name: name, compat: d['__compat']};
        } else {
            yield* find_features(d, name);
        }
    }
}

function supported_usage(versions) {
    let t = 0;
    for(let {agent, version} of versions) {
        t += caniuse_data.agents[mdn_caniuse_browser_map[agent]].usage_global[version] || 0;
    }
    return 100 * t / total_observable;
}

class Feature {
    constructor(name, compat) {
        this.name = name;
        this.compat = compat;
        this.included = false;
        this.supported_versions = this.calc_supported_versions();
        this.supported_usage = this.calc_supported_usage();
    }

    calc_supported_versions() {
        let all_versions = [];
        for(let [agent, support_statements] of Object.entries(this.compat.support)) {
            const agent_data = caniuse_data.agents[mdn_caniuse_browser_map[agent]];
            if(!agent_data) {
                continue;
            }

            const statement = Array.isArray(support_statements) ? support_statements[0] : support_statements;
            if(statement === 'mirror') {
                // TODO
            }
            const version = statement.version_added;
            let versions = Object.keys(agent_data.usage_global);
            if(version === true) {
            } else if(typeof version == 'string'){ 
                const min_version = parseFloat(version.replace(/^≤/u,''));
                versions = versions.filter(v=>parseFloat(v) >= min_version);
            } else {
                versions = [];
            }

            all_versions = all_versions.concat(versions.map(v => {return {pk: `${agent} ${v}`, agent, version: v}}));
        }
        return all_versions;
    }

    calc_supported_usage() {
        return supported_usage(this.supported_versions)
    }

    matches_query(query) {
        const body = [this.name, this.compat.description].filter(x=>x).join(' ').toLowerCase();
        return body.indexOf(query.toLowerCase().trim()) >= 0;
    }
}

function intersection(setA, setB) {
    const _intersection = [];
    for (const elem of setB) {
        if (setA.find(e2 => e2.pk == elem.pk)) {
            _intersection.push(elem);
        }
    }
    return _intersection;
}

async function go() {
    const {caniuse_data, mdn_data, features} = await load_data();

    const app = createApp({
        data() {
            return {
                search: '',
                caniuse_data: caniuse_data,
                mdn_data: mdn_data,
                features: features,
            }
        },

        computed: {
            shown_features() {
                return this.features.filter(f => {
                    return f.included || f.matches_query(this.search);
                })
            },

            supported_versions() {
                let versions = null;
                for(let f of this.features.filter(f=>f.included)) {
                    if(versions === null) {
                        versions = f.supported_versions;
                    } else {
                        versions = intersection(versions, f.supported_versions);
                    }
                }
                return versions || [];
            },

            supported_usage() {
                return supported_usage(this.supported_versions);
            }
        }
    });

    app.mount('#app');
}

go();
