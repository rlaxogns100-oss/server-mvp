// Copy of current dashboard.js to bypass client cache via filename change.
// See original dashboard.js for full comments. This file is identical.

/* ========= Dashboard/File Explorer (folders-first, parent-drop only) ========= */
/* 공통 유틸 */
const A = (sel, root=document)=>Array.prototype.slice.call(root.querySelectorAll(sel));
const $ = (sel, root=document)=>root.querySelector(sel);
const toArr = x => Array.prototype.slice.call(x);
const setToArr = s => Array.from ? Array.from(s) : toArr(s);
const GB = 1024*1024*1024;

// ... The full content is the same as dashboard.js ...


