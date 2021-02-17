const vlq = require('./vlq.js');

// property that we've attached source map to in the std __coverage__ obj.
const srcMapPropertyName = 'inputSourceMap';

export default compress;

// coverage is coverage object
// bMap is vlq'd src map
// returns { stNo: [line0, line1, ...] }
const getOriginalMappings = (cov, bMap) => {
    const countForLine = Object.keys(cov.statementMap).reduce((memo, s) => {
        // to print and make sense of
        const count = cov.s[s];

        // lines & columns of intermediary source map
        const sl = cov.statementMap[s].start.line;
        const sc = cov.statementMap[s].start.column;
        const el = cov.statementMap[s].end.line;
        const ec = cov.statementMap[s].end.column;

        const start = bMap[sl].find(mapping => {
            // find start column
            return mapping.split(' ')[0] === '' + sc;
        });
        const end = bMap[el].find(mapping => {
            return mapping.split(' ')[0] === '' + ec;
        });

        // FIXME:
        // // This will show, for each statement, what we get for "start"
        // // and "end" when we map back to the original file. There are some
        // // weird results in here that I can't explain at the moment, but not
        // // so weird that it should hold up alpha release. we'll need to go
        // // back and figure out why, for example, some lines are counted twice,
        // // or contents inside of a for loop aren't always logged multiple times
        // // even though the for loop itself is.
        // console.log('--------------------------')
        // console.log(`count: ${count}`);
        // console.log(`start: ${start}`);
        // console.log(`end:${end}`);
        // console.log('--------------------------')
        if (start) {
            const lineCol = start.split(' ')[3];
            const lineNo = lineCol.split(':')[0];

            // put this into a format that's really easy for a worker node to parse.
            if (memo == '') {
                memo = `${lineNo} ${count}`;
            } else {
                memo = `${memo} ${lineNo} ${count}`;
            }
        }

        return memo;
    }, '');
    return countForLine;
};

// https://gist.github.com/bengourley/c3c62e41c9b579ecc1d51e9d9eb8b9d2
const formatMappings = (mappings, sources, names) => {
    const vlqState = [0, 0, 0, 0, 0];

    return mappings.split(';').reduce((accum, line, i) => {
        accum[i + 1] = formatLine(line, vlqState, sources, names);
        vlqState[0] = 0;
        return accum
    }, {});
}

const formatLine = (line, state, sources, names) => {
    const segs = line.split(',')
    
    return segs.map(seg => {
        if (!seg) return '';
        
        const decoded = vlq.decode(seg);
        for (var i = 0; i < 5; i++) {
            state[i] = typeof decoded[i] === 'number' ? state[i] + decoded[i] : state[i]
        }
        
        return formatSegment(...state.concat([ sources, names ]))
    });
}

// transforms line numbers & counts to top line numbers
// input string, output string
function setTopN(line, n) {
    const elems = line.split(' ');
    const asObjects = []; // { line, count}
    for (var i = 0; i < elems.length; i += 2) {
        asObjects.push({
            line: parseInt(elems[i]) - 1,
            count: elems[i+1],
        });
    }
    asObjects.sort(function(a,b){return b.count - a.count});
    const res = [];
    for (var i = 0; i < n; i++) {
        if (asObjects[i]) {
            res.push(asObjects[i].line);
        }
    }
    return res.join(' ');
}

const formatSegment = (col, source, sourceLine, sourceCol, name, sources, names) =>
  `${col + 1} => ${sources[source]} ${sourceLine + 1}:${sourceCol + 1}${names[name] ? ` ${names[name]}` : ``}`

// compress takes entire coverage object with built-in sourcemap and constructs a
// report that codecov's worker node can make sense of. should work to optimize this
// function to:
//    1. minimimize bytes sent over the wire
//    2. minimize worker load / offset reasonable computation to client
// 
// coverage is the result of calling nyc's instrument function with sourcemap,
// i.e. it's the standard __coverage__ object plus an "inputSourceMap" that
// is the sourcemap that brought us from the original source to that point in
// time.
// 
// returns {
//      "path/from/root": [ line_0, count_0, line_1, ...]
// }
function compress(coverage, root) {
    const compressed = {};

    Object.keys(coverage).forEach(fPath => {
        const cpcObject = coverage[fPath];
        
        if (!cpcObject[srcMapPropertyName]) {
            // fail silently
            console.error("source wasn't instrumented with source maps.. can't proceed.");
            return null;
        }
    
        const srcMap = cpcObject[srcMapPropertyName];
    
        // use vlq to take the rather-cryptic mappings typically found in a sourcemap
        // and turn them into an easy lookup table.
        // 
        // betterMap can be passed to a higher-order function to retrieve the exact lines
        // that we wish to report as covered
        const betterMap = formatMappings(srcMap.mappings, srcMap.sources, srcMap.names);

        const key = fPath.replace(root, "");

        // * cut out unwanted trace data
        // * use parsed src map to remap lines
        // * return to format understood by API
        compressed[key] = getOriginalMappings(cpcObject, betterMap);

        // INPUT: 'L1 C1 L2 C2 L3 C3...'
        // OUTPUT: 'maxN(L1, L2, L3)'
        compressed[key] = setTopN(compressed[key], 3);
    });

    return compressed;
};

window.transmit = function(host, token, commit, root) {
    const smallmap = compress(__coverage__, root);

	const ppreq = `${host}/critical_path/?package=bash-20200430-d757c17&token=${token}&branch=master&commit=${commit}`;
    
    var res = fetch(ppreq, {
      method: 'POST',
      'Content-Type': 'text/plain',
      'Content-Encoding': 'gzip',
      'X-Content-Encoding': 'gzip',
      'Accept': 'text/plain',
    })
      .then(function(response) {
          return response.text();
        })
      .then(function(signedput) {
        // Create a file object from coverage json
        const lines = Object.keys(smallmap).map(fn => {
            return `${fn} ${smallmap[fn]}`;
        });

        console.log(lines);
        
        const blob = new Blob([lines.join('\n')], {type: "text/plain"});
        const f = new File([blob], "x.json");
        
        return fetch(signedput, {
          method: 'PUT',
          body: f,
        })
      });
  }
