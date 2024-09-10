data: data.caniuse.json data.mdn.json

data.caniuse.json: FORCE
	curl -L https://github.com/Fyrd/caniuse/raw/main/data.json | node compress.mjs > $@

data.mdn.json: FORCE
	curl -L https://unpkg.com/@mdn/browser-compat-data/data.json | node compress.mjs > $@

FORCE:
