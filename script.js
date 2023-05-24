import { createApp } from './vue.esm-browser.js'

function intersection(setA, setB) {
    const _intersection = [];
    for (const elem of setB) {
        if (setA.find(e2 => e2.pk == elem.pk)) {
            _intersection.push(elem);
        }
    }
    return _intersection;
}

function version_to_float(v) {
    if(isNaN(v)) {
        return Infinity;
    }
    return parseFloat(v);
}

function max_version(a,b) {
    a = version_to_float(a)
    b = version_to_float(b);
    return Math.max(a,b);
}

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
const caniuse_mdn_browser_map = Object.fromEntries(Object.entries(mdn_caniuse_browser_map).map(([a,b]) => [b,a]));

let total_observable = 0;

function supported_usage(versions) {
    let t = 0;
    for(let [mdn_agent, caniuse_agent] of Object.entries(mdn_caniuse_browser_map)) {
        const version = version_to_float(versions[mdn_agent]);
        for(let [v,usage] of Object.entries(caniuse_data.agents[caniuse_agent].usage_global)) {
            if(version_to_float(v) >= version) {
                t += usage;
            }
        }
    }
    return 100 * t / total_observable;
}

class FeatureTree {
    constructor(name) {
        this.name = name || '';
        this.subtrees = [];
        this.features = [];
    }

    all_features() {
        let out = this.features.slice();
        for(let st of this.subtrees) {
            out = out.concat(st.all_features());
        }
        return out;
    }

    get_subtree(name) {
        let subtree = this.subtrees.find(t=>t.name==name);
        if(!subtree) {
            subtree = new FeatureTree(name);
            this.subtrees.push(subtree);
        }
        return subtree;
    }

    find_feature(path) {
        const [name] = path;
        if(path.length == 1) {
            return this.features.find(f=>f.name==name);
        } else {
            const subtree = this.subtrees.find(s=>s.name==name);
            return subtree && subtree.find_feature(path.slice(1));
        }
    }

    serialize() {
        return {
            name: this.name,
            categories: this.subtrees.map(s => s.serialize()).filter(d => d.categories.length || d.features.length),
            features: this.features.filter(f => f.included).map(f => {return {name: f.name, included: f.included}})
        };
    }

    shown_features(search) {
        return this.features.filter(f => f.matches_query(search));
    }

    should_open(search) {
        return search && (this.shown_features(search).length > 0 || this.subtrees.some(st=>st.should_open(search)));
    }
}

function place_mdn_feature(root,path,compat, group_parent, i=0) {
    const name = path[i];
    if(i==path.length-1) {
        if(group_parent) {
            root = root.get_subtree(name);
        }
        const feature = new MDNFeature(name, compat, path);
        if(feature.supported_usage < 100) {
            root.features.push(feature);
        }
    } else if(i<path.length) {
        const subtree = root.get_subtree(name);
        place_mdn_feature(subtree, path, compat, group_parent, i+1);
    }
}

class Feature {
    constructor(name, compat) {
        this.name = name;
        this.included = false;
    }

    finish_construction() {
        this.supported_versions = this.calc_supported_versions();
        this.supported_usage = this.calc_supported_usage();
    }

    calc_supported_versions() {
        let support = {};
        for(let [agent, support_statements] of Object.entries(this.compat.support)) {
            const statement = Array.isArray(support_statements) ? support_statements[0] : support_statements;
            if(statement === 'mirror') {
                // TODO
            }
            const version = statement.version_added;
            let min_version;
            if(version === true) {
                min_version = -Infinity;
            } else if(typeof version == 'string'){ 
                min_version = parseFloat(version.replace(/^≤/u,''));
            } else {
                min_version = Infinity;
            }

            support[agent] = min_version;
        }
        return support;
    }

    calc_supported_usage() {
        return supported_usage(this.supported_versions)
    }

    matches_query(query) {
        query = query.toLowerCase().trim();
        if(!query) {
            return true;
        }
        const body = this.search_body().filter(x=>x).join(' ').toLowerCase();
        return body.indexOf(query) >= 0;
    }
    search_body() {
        return [this.name, this.description];
    }
}

class MDNFeature extends Feature {
    constructor(name, compat, path) {
        super(name);
        this.compat = compat;
        this.path = path;
        this.key = path.join('.');
        this.description = compat.description;
        this.documentation_url = compat.mdn_url;
        this.finish_construction();
    }
}

class CanIUseFeature extends Feature {
    constructor(name, data) {
        super(name);
        this.data = data;
        this.description = data.title;
        this.documentation_url = `https://caniuse.com/${name}`;
        this.finish_construction();
    }

    calc_supported_versions() {
        const support = {}
        for(let [agent, versions] of Object.entries(this.data.stats)) {
            const version = Object.entries(versions).filter(([v,s]) => s.startsWith('y')).map(([v,s]) => v)[0];

            let min_version;
            if(version === true) {
                min_version = -Infinity;
            } else if(typeof version == 'string'){ 
                min_version = parseFloat(version.replace(/^≤/u,''));
            } else {
                min_version = Infinity;
            }

            support[caniuse_mdn_browser_map[agent]] = min_version;
        }
        return support;
    }
}

function restore(tree, data) {
    for(let std of (data.subtrees || data.categories || [])) {
        const subtree = tree.subtrees.find(st => st.name == std.name);
        if(subtree) {
            restore(subtree, std);
        }
    }
    for(let fd of data.features || []) {
        const f = tree.features.find(f => f.name == fd.name);
        if(f && fd.included) {
            f.included = fd.included;
        }
    }
}

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

    const tree_root = new FeatureTree('');

    Array.from(find_features(mdn_data)).forEach(({path, compat, group_parent}) => {
        place_mdn_feature(tree_root, path, compat, group_parent);
    });

    const caniuse_tree = new FeatureTree('caniuse');
    Object.entries(caniuse_data.data).forEach(([name, d]) => {
        caniuse_tree.features.push(new CanIUseFeature(name, d));
    });

    tree_root.subtrees.push(caniuse_tree);

    const serialized = JSON.parse(localStorage.getItem('can-i-also-use') || '{}');
    restore(tree_root, serialized);


    return {caniuse_data, mdn_data, tree_root};
}

function* find_features(data, prefix=[], add_to_path=true) {
    for(let [k,d] of Object.entries(data)) {
        if(k.startsWith('__') || k=='browsers') {
            continue;
        }
        const path = prefix.slice();
        path.push(k);
        if(d['__compat']) {
            yield {path: path, compat: d['__compat'], group_parent: add_to_path};
            yield* find_features(d, path, false);
        } else {
            yield* find_features(d, path);
        }
    }
}

const FeatureTreeComponent = {
    props: ['tree', 'search'],

    data() {
        return {
            open: false,
            show_all_features: false,
            show_all_subtrees: false
        }
    },

    watch: {
        search() {
            this.show_all_features = false;
            this.show_all_subtrees = false;
        }
    },

    computed: {
        shown_features() {
            this.open = !!this.tree.should_open(this.search);
            if(this.show_all_features) {
                return this.tree.features;
            }
            const features = this.tree.shown_features(this.search);
            return features;
        },

        num_hidden_features() {
            return this.tree.features.length - this.shown_features.length;
        },

        shown_subtrees() {
            if(this.show_all_subtrees) {
                return this.tree.subtrees;
            }
            return this.tree.subtrees.filter(st => !this.search || st.should_open(this.search));
        },
        
        num_hidden_subtrees() {
            return this.tree.subtrees.length - this.shown_subtrees.length;
        },

    },

    methods: {
        toggle(evt) {
            this.open = !evt.target.parentElement.open;
            evt.preventDefault();
        },
        show_hidden_features() {
            this.show_all_features = true;
        },
        show_hidden_subtrees() {
            this.show_all_subtrees = true;
        }
    },

    template: `
<details class="sub-tree" :open="open">
    <summary @click="toggle">{{tree.name}}</summary>
    <ul>
        <li v-for="item in shown_subtrees" :key="item.name">
            <featuretree :tree="item" :search="search"></featuretree>
        </li>
        <li class="hidden-subtrees" v-if="num_hidden_subtrees" @click="show_hidden_subtrees" role="button"><small>{{num_hidden_subtrees}} hidden subcategories</small></li>
    </ul>
    <ul>
        <li v-for="feature in shown_features" :key="feature.key" :data-key="feature.key">
            <featureselector :feature="feature"></featureselector>
        </li>
        <li class="hidden-features" v-if="num_hidden_features" @click="show_hidden_features" role="button"><small>{{num_hidden_features}} hidden features</small></li>
    </ul>
</details>
    `
}

const FeatureSelectorComponent = {
    props: ['feature'],

    template: `
    <div class="feature-selector">
        <label>
            <input type="checkbox" v-model="feature.included"> 
            <span v-if="feature.description" v-html="feature.description"></span>
            <code v-else>{{feature.name}}</code>
        </label>
        ({{feature.supported_usage.toFixed(2)}}%)
        <mdnlink :feature="feature"></mdnlink>
    </div>
    `
}

const MDNLinkComponent = {
    props: ['feature'],

    template: `
<a class="mdn" v-if="feature.documentation_url" :href="feature.documentation_url" target="mdn-docs" title="MDN documentation on this">?</a>
    `
}

const DownloadComponent = {
    props: ['data','filename'],

    computed: {
        href() {
            var blob = new Blob([JSON.stringify(this.data)],{type: 'text/json'});
            return URL.createObjectURL(blob);
        }
    },

    template: `
    <a :href="href" :download="filename"><slot></slot></a>
    `
}

async function go() {
    const {tree_root, caniuse_data, mdn_data} = await load_data();

    document.body.classList.add('loaded');

    const app = createApp({
        data() {
            return {
                staged_search: '',
                search: '',
                caniuse_data: caniuse_data,
                mdn_data: mdn_data,
                tree: tree_root
            }
        },

        watch: {
            included_features(ov,nv) {
                const s = this.tree.serialize();
                localStorage.setItem('can-i-also-use', JSON.stringify(s));
            }
        },

        methods: {
            toggle_feature(f) {
                f.included = !f.included;
            },

            clear_search() {
                this.search = "";
            },

            do_search(e) {
                this.search = this.staged_search;
            },

            async upload_settings(e) {
                const [file] = e.target.files;
                if(!file) {
                    return;
                }
                const text = await file.text();
                const data = JSON.parse(text);
                restore(this.tree, data);
            }
        },

        computed: {
            included_features() {
                const fs = this.tree.all_features().filter(f => {
                    return f.included;
                });
                window.fs = fs;
                return fs;
            },

            supported_versions() {
                let versions = Object.fromEntries(Object.keys(mdn_data.browsers).map(b=>[b,-Infinity]));;
                for(let f of this.tree.all_features().filter(f=>f.included)) {
                    for(let [agent,min1] of Object.entries(versions)) {
                        const min2 = f.supported_versions[agent];
                        versions[agent] = max_version(min1,min2);
                    }
                }
                return versions;
            },

            supported_versions_summary() {
                const vs = Object.entries(this.supported_versions).map(([browser, version]) => {
                    const release = Object.entries(mdn_data.browsers[browser].releases).filter(([v,r]) => v >= version).map(([v,r]) => r)[0];
                    const blocking_features = this.included_features.filter(f => version_to_float(f.supported_versions[browser]) == version);
                    const usage_data = caniuse_data.agents[mdn_caniuse_browser_map[browser]]?.usage_global;
                    const unsupported_usage = usage_data ? Object.entries(usage_data).filter(([v,u]) => version_to_float(v) < version).map(([v,u]) => u).reduce((a,b) => a+b, 0) : 0;
                    return {
                        browser,
                        version,
                        release,
                        blocking_features,
                        unsupported_usage,
                        name: mdn_data.browsers[browser].name
                    };
                });
                window.vs = vs;
                return vs;
            },

            supported_usage() {
                return supported_usage(this.supported_versions);
            },
        }
    });
    
    app.component('featuretree', FeatureTreeComponent);
    app.component('featureselector', FeatureSelectorComponent);
    app.component('mdnlink', MDNLinkComponent);
    app.component('download-file', DownloadComponent);

    app.mount('#app');

    window.app = app;
}

go();
