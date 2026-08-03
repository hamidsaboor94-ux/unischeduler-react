const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Every notification has exactly one recipient (notifications.userId) — this fetch is the
// only way the client reads them, and it is always scoped to the authenticated caller
// (req.user.sub), never a value the client can supply. A user can never fetch, and the server
// can never return, another account's notifications.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||50));
  const clauses=['userId=?'],params=[req.user.sub];
  if(req.query.type){clauses.push('type=?');params.push(req.query.type);}
  if(req.query.severity){clauses.push('severity=?');params.push(req.query.severity);}
  if(req.query.status==='unread')clauses.push('isRead=0');
  if(req.query.status==='read')clauses.push('isRead=1');
  const where=clauses.join(' AND '),total=(await get(`SELECT COUNT(*) n FROM notifications WHERE ${where}`,params)).n;
  const items=await all(`SELECT * FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
  const shaped=items.map(n=>({...n,actionData:n.actionData?JSON.parse(n.actionData):null,metadata:n.metadata?JSON.parse(n.metadata):null}));
  if(Object.keys(req.query).length===0)return res.json(shaped); // backward-compatible boot response
  res.json({items:shaped,total,page,pageSize});
}));

router.get('/unread-count',requireAuth,asyncHandler(async(req,res)=>res.json({count:(await get('SELECT COUNT(*) n FROM notifications WHERE userId=? AND isRead=0',[req.user.sub])).n})));

router.put('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await run('UPDATE notifications SET isRead = 1,readAt=CURRENT_TIMESTAMP WHERE userId = ? AND isRead = 0', [req.user.sub]);
  res.json({ ok: true });
}));

router.put('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const changed=await run('UPDATE notifications SET isRead = 1,readAt=CURRENT_TIMESTAMP WHERE id = ? AND userId = ?', [req.params.id, req.user.sub]);
  if(!changed.changes)return res.status(404).json({error:'Notification not found.'});
  res.json({ ok: true });
}));

router.get('/preferences',requireAuth,asyncHandler(async(req,res)=>res.json(await all('SELECT category,enabled,updatedAt FROM notification_preferences WHERE userId=? ORDER BY category',[req.user.sub]))));
router.put('/preferences/:category',requireAuth,asyncHandler(async(req,res)=>{
  const {OPTIONAL_CATEGORIES}=require('../notificationTypes');if(!OPTIONAL_CATEGORIES.has(req.params.category))return res.status(400).json({error:'This category is mandatory or unknown.'});
  await run(`INSERT INTO notification_preferences(userId,category,enabled) VALUES(?,?,?) ON CONFLICT(userId,category) DO UPDATE SET enabled=excluded.enabled,updatedAt=CURRENT_TIMESTAMP`,[req.user.sub,req.params.category,req.body?.enabled===false?0:1]);
  res.json({category:req.params.category,enabled:req.body?.enabled!==false});
}));

module.exports = router;
