const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {prepareDataLocation}=require('../src/services/dataLocation');
test('migrates existing tasks and screenshots without deleting originals or replacing migrated data',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yanqian-location-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const old=path.join(root,'xhznl-todo-list');fs.mkdirSync(path.join(old,'attachments'),{recursive:true});
 fs.writeFileSync(path.join(old,'data.json'),'original');fs.writeFileSync(path.join(old,'attachments','image.png'),'image');
 const next=prepareDataLocation(root,old);assert.equal(next,path.join(root,'yanqian-todo-list'));
 assert.equal(fs.readFileSync(path.join(next,'data.json'),'utf8'),'original');assert.equal(fs.readFileSync(path.join(next,'attachments','image.png'),'utf8'),'image');
 assert.ok(fs.existsSync(path.join(old,'data.json')));fs.writeFileSync(path.join(next,'data.json'),'updated');prepareDataLocation(root,old);assert.equal(fs.readFileSync(path.join(next,'data.json'),'utf8'),'updated');
});
