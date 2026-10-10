import {readFile,writeFile} from 'node:fs/promises';
const file='android/app/build.gradle';let gradle=await readFile(file,'utf8');
if(!gradle.includes('firebase-messaging:'))gradle=gradle.replace('dependencies {',"dependencies {\n    implementation platform('com.google.firebase:firebase-bom:34.4.0')\n    implementation 'com.google.firebase:firebase-messaging'\n    implementation 'androidx.core:core:1.17.0'");
await writeFile(file,gradle);
console.log('Native configuration ready. Firebase Android config and Apple signing are required for push delivery.');

await import('./configure-ios-extension.mjs');
