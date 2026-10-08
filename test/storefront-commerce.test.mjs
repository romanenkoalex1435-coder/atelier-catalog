import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './helpers/storefront-harness.mjs';
const item=(id,extra={})=>({id,title:'Shirt '+id,price:100,active:true,images:['/images/'+id+'.jpg'],condition:'Хорошее',...extra});
const respond=(h,data)=>h.requests.at(-1).resolve({ok:true,json:async()=>data});

test('cut preview keeps originals and defect photo index in the gallery',()=>{
 const h=harness(); h.ui.productView(item('a',{preview:'/images/preview/a.webp',images:['/images/a.jpg','/images/b.jpg'],size:'L',notes:[{img:1,x:10,y:20,type:'flaw',text:'Stain'}]}))();
 const html=h.get('#sheet-body').innerHTML;
 assert.match(html,/data-zoom="\/images\/a.jpg"/);
 assert.match(html,/data-zoom="\/images\/b.jpg"/);
 assert.match(html,/data-img="2"/);
 assert.match(html,/product-summary/);
});

test('opening cart fetches current stock and retains unavailable positions with explanation',async()=>{
 const h=harness(); h.ui.setProducts([item('a')]); h.ui.setCart([{id:'a'}]);
 assert.equal(typeof h.ui.openCart,'function');
 const opening=h.ui.openCart();
 assert.equal(h.requests.at(-1).url,'/data/products.json');
 respond(h,[item('a',{sold:true})]); await opening;
 assert.match(h.get('#sheet-body').innerHTML,/Продано/);
 assert.equal(h.ui.getCart().length,1,'do not silently delete customer selection');
 assert.match(h.get('#sheet-body').innerHTML,/aria-disabled="true"/);
});

test('checkout refresh detects changed price, asks to review, then uses new price on retry',async()=>{
 const h=harness();h.ui.setProducts([item('a')]);h.ui.setCart([{id:'a'}]);h.ui.setSeller('sellername');h.ui.openSheet(h.ui.cartView);
 assert.equal(typeof h.ui.prepareOrder,'function');
 const first=h.ui.prepareOrder(); respond(h,[item('a',{price:250})]); assert.equal(await first,null);
 assert.match(h.get('#sheet-body').innerHTML,/250/);
 const second=h.ui.prepareOrder(); respond(h,[item('a',{price:250})]); const link=await second;
 assert.match(decodeURIComponent(link),/250/);
 assert.match(link,/^https:\/\/t.me\/sellername\?text=/);
});

test('checkout fails closed on network error and preserves selection',async()=>{
 const h=harness();h.ui.setProducts([item('a')]);h.ui.setCart([{id:'a'}]);h.ui.setSeller('sellername');h.ui.openSheet(h.ui.cartView);
 assert.equal(typeof h.ui.prepareOrder,'function');
 const pending=h.ui.prepareOrder();h.requests.at(-1).reject(new Error('Offline'));
 assert.equal(await pending,null);assert.equal(h.ui.getCart().length,1);
 assert.match(h.get('#sheet-body').innerHTML,/проверить/i);
});

test('late cart response does not replace another sheet',async()=>{
 const h=harness();h.ui.setProducts([item('a')]);h.ui.setCart([{id:'a'}]);
 assert.equal(typeof h.ui.openCart,'function');
 const pending=h.ui.openCart();h.ui.openSheet(()=>{h.get('#sheet-body').innerHTML='Different view';h.get('#sheet-body').dataset.view='other';});
 respond(h,[item('a',{price:300})]);await pending;
 assert.equal(h.get('#sheet-body').innerHTML,'Different view');
});


test('admin preview accepts only same-origin parent, shows unsaved photos, and never fetches catalog',()=>{
 const h=harness(undefined,{previewMode:true});
 const product=item('draft',{images:['data:image/jpeg;base64,YQ==']});
 const message={origin:'https://shop.test',source:h.parent,data:{type:'rewear-admin-preview',product}};
 h.listeners.message({...message,origin:'https://other.test'});assert.equal(h.get('#sheet').hidden,true);
 h.listeners.message({...message,source:{}});assert.equal(h.get('#sheet').hidden,true);
 h.listeners.message(message);assert.match(h.get('#sheet-body').innerHTML,/data:image\/jpeg;base64,YQ==/);
 assert.doesNotMatch(h.get('#sheet-body').innerHTML,/id="add"|data-share=/);
 assert.equal(h.requests.length,0);
});
test('Escape in preview requests close in parent after zoom is dismissed',()=>{
 const h=harness(undefined,{previewMode:true});
 h.listeners.message({origin:'https://shop.test',source:h.parent,data:{type:'rewear-admin-preview',product:item('draft')}});
 h.ui.openZoom('/images/draft.jpg','Draft');
 h.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(h.get('#zoom').hidden,true);
 h.listeners.keydown({key:'Escape',preventDefault(){}});
 assert.equal(h.messages.at(-1).data.type,'rewear-preview-close');
});

test('blocked clipboard exposes fresh order text for manual copying', async()=>{
 const h=harness(); h.ui.setProducts([item('a')]); h.ui.setCart([{id:'a'}]); h.ui.setSeller('sellername'); h.ui.openSheet(h.ui.cartView);
 const target={closest:selector=>selector==='#copy-order'?{}:null};
 const pending=h.get('#sheet-body').listeners.click({target,preventDefault(){}});
 respond(h,[item('a')]); await pending;
 assert.match(h.get('#sheet-body').innerHTML,/id="order-text"/);
 assert.match(h.get('#sheet-body').innerHTML,/Shirt a/);
 assert.match(h.get('#sheet-body').innerHTML,/readonly/);
});
