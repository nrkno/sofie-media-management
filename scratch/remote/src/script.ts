'use strict'
import { NodeVM, CompilerFunction } from 'vm2'
import * as ts from "typescript"

let tsc: CompilerFunction = (source: string, _filename: string) => {
    return ts.transpile(source)
}

const vm = new NodeVM({
    compiler: tsc,
    require: {
        external: ['redioactive', 'beamcoder']
    }
})

vm.run("'use strict'\nimport r from 'redioactive'; r([1,2,3]).each(console.log)", __filename)
vm.run("'use strict'\nimport * as beamy from 'beamcoder'; console.log(beamy.versions())", __filename)