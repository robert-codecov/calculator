const { createInstrumenter } = require('istanbul-lib-instrument');
const execSync = require('child_process').execSync;
const fs = require('fs');
const joinPath = require('memory-fs/lib/join');
const path = require('path');
const webpack = require('webpack');

const { Volume } = require('memfs');

const instrumenter = createInstrumenter({
  autoWrap: true,
  coverageVariable: '__coverage__',
  embedSource: true,
  compact: false,
  produceSourceMap: true,
  esModules: true,
});

module.exports = function(src, map) {
  const callback = this.async();

  const opts = Object.assign({
    ignore: ['/node_modules/'],
    entry: this._compiler.options.entry[0],
  }, src.query || {});

  const shouldIgnore = opts.ignore.reduce((memo, val) => {
    return memo || this.resourcePath.indexOf(val) >= 0;
  }, false);

  if (shouldIgnore) {
    return callback(null, src, map);
  }

  console.log(`Instrumenting ${this.resourcePath}`);
  let ret = instrumenter.instrumentSync(src, this.resourcePath, map);

  // if we're at the entry file, we'll append the payload used for
  // transmitting critical path data.
  if (this.resourcePath == opts.entry) {
    const sha = getSha();
    
    // createPayload minifies payload.js and its deps
    createPayload({ entry: './payload.js' })
      .catch(callback)
      .then(payload => {
        callback(null, ret + payload);
      });
  } else {
    callback(null, ret);
  
    // https://webpack.js.org/api/loaders/ in async mode loader
    // must return undefined
    return undefined;
  }
};

// Returns entire payload that is to be appended to the entrypoint of this
// project, i.e., it'll be globally available from the built project.
// Borrowed some stuff from previous iteration (without webpack)
async function createPayload(options) {
  const srcVol = fs;
  const targetVol = ensureWebpackMemoryFs(new Volume());

  const mountAt = path.normalize(__dirname, path.dirname(options.entry));
  const entry = path.resolve(mountAt, options.entry);

  cloneFs(srcVol, targetVol, mountAt);

  return bundleFromVolume(targetVol, entry);
}

function cloneFs(srcFs, targetFs, root) {
  walkFs(srcFs, root).forEach(fqPath => {
    const walkDir = path.dirname(fqPath);
    targetFs.mkdirSync(walkDir, { recursive: true });

    const buffer = srcFs.readFileSync(fqPath);

    targetFs.writeFileSync(fqPath, buffer, 'utf8');
  });
}

function bundleFromVolume(volume, entry) {
  return new Promise((resolve, reject) => {
    const output = {
      filename: '23987234879-virtual-index.bundle.js',
      path: __dirname,
    };

    const compiler = webpack({
      mode: 'production',
      entry,
      output
    });

    compiler.inputFileSystem = volume;
    compiler.outputFileSystem = volume;

    compiler.run((e, stats) => {
      if (e) return reject(e);

      const bundlePath = path.resolve(output.path, output.filename);

      const bundle = volume.readFileSync(bundlePath, 'utf8');

      resolve(bundle);
    });
  });
}

function walkFs(volume, dir, filelist) {
  const files = volume.readdirSync(dir);

  filelist = filelist || [];

  files.forEach(function(file) {
    const filepath = path.join(dir, file);

    if (volume.statSync(filepath).isDirectory()) {
      filelist = walkFs(volume, filepath, filelist);
    } else {
      filelist.push(filepath);
    }
  });

  return filelist;
};

function ensureWebpackMemoryFs(fs) {
  if (fs.join) {
    return fs;
  }

  const nextFs = Object.create(fs);
  nextFs.join = joinPath;

  return nextFs;
}

// get the current commit
function getSha() {
  return execSync('git rev-parse HEAD').toString().trim();
}