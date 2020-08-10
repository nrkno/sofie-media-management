import * as beamy from 'beamcoder'

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
    inputParams,
    outputParams: [ {
        pixelFormat: 'yuv422'
    } ],
    filterSpec: 'scale=160:-1'
}).then(console.log, console.error).then(done, done);
