import {build} from 'esbuild';
import {mkdir,cp,rm,readdir} from 'node:fs/promises';
await build({entryPoints:['mobile/src/bridge.js'],bundle:true,format:'iife',outfile:'mobile-bridge.js',target:'es2020'});
await rm('www',{recursive:true,force:true});await mkdir('www',{recursive:true});
for(const file of ['index.html','manifest.json','icon.svg','calls.js','notifications.js','mobile-bridge.js','push-config.json','sw.js','icons','assets'])await cp(file,'www/'+file,{recursive:true});
console.log('Web and mobile bundle built');
