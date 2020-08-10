import { NodeVM, CompilerFunction, VMScript } from 'vm2'
import * as ts from 'typescript'

const tsOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2017
}

let tsc: CompilerFunction = (source: string, _filename: string) => {
    const madeByTranspile = ts.transpile(source, tsOptions)
    console.log(madeByTranspile)
    return madeByTranspile
}

const testFn = `import * as beamy from 'beamcoder'

let done = () => { console.log('DONE!') };

console.log('Starting');

let inputParams = new Array({
    width: 1920,
    height: 1080,
    pixelFormat: 'yuv420p',
    timeBase: [1, 25],
    pixelAspect: [1, 1]
});

console.log('Is it an array?', Array.isArray(inputParams));

beamy.filterer({
    filterType: 'video',
    inputParams: inputParams,
    outputParams: [ {
        pixelFormat: 'yuv422'
    } ],
    filterSpec: 'scale=160:-1'
}).then(console.log, console.error).then(done, done);
` 

const vm = new NodeVM({
    compiler: tsc,
    require: {
        external: ['redioactive', 'beamcoder'],
        import: ['beamcoder']
    }
})

const script = new VMScript(testFn, { compiler: tsc })
console.log(script.code)
vm.run(script)