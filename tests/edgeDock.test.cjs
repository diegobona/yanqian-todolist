const {test}=require('node:test');
const assert=require('node:assert/strict');
const {dockEdge,handleBounds,contains}=require('../src/services/edgeDock');
test('dock handles remain inside each edge of a negative-coordinate display',()=>{
 const area={x:-1920,y:0,width:1920,height:1040};
 for(const [edge,bounds] of Object.entries({left:{x:-1920,y:200,width:400,height:400},right:{x:-400,y:200,width:400,height:400},top:{x:-1000,y:0,width:400,height:400},bottom:{x:-1000,y:640,width:400,height:400}})){
  const dock=dockEdge(bounds,[area]);assert.equal(dock.edge,edge);
  const handle=handleBounds(bounds,dock);assert.ok(contains(area,{x:handle.x,y:handle.y}));assert.ok(contains(area,{x:handle.x+handle.width-1,y:handle.y+handle.height-1}));
 }
 assert.equal(dockEdge({x:-1000,y:200,width:400,height:400},[area]),null);
});
