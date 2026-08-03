const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { get, all, run, logAudit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../authz');
const asyncHandler = require('../middleware/asyncHandler');
const { can } = require('../permissions');
const service = require('../graduationService');

const router = express.Router();
const guard = action => requirePermission(`graduation.${action}`);
const explicitFinalizationGuard = async (req,res,next) => {
  if(!req.user)return res.status(401).json({error:'Missing token'});
  const secondary=await all('SELECT role FROM user_roles WHERE userId=?',[req.user.sub]);
  const roles=[req.user.role,...secondary.map(r=>r.role)].filter(r=>r!=='admin');
  if(!roles.length)return res.status(403).json({error:'Graduation finalization requires an explicitly granted non-admin role.','code':'EXPLICIT_GRADUATION_AUTH_REQUIRED'});
  const marks=roles.map(()=>'?').join(',');
  const allowed=await get(`SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permissionId WHERE rp.role IN (${marks}) AND p.module='graduation' AND p.action='Finalize' LIMIT 1`,roles);
  if(!allowed)return res.status(403).json({error:'You do not have explicit graduation finalization permission.','code':'NO_FINALIZATION_PERMISSION'});
  next();
};
const respond = (res, err) => err.status
  ? res.status(err.status).json({ error: err.message, code: err.code, details: err.details })
  : (() => { throw err; })();

router.get('/candidates', requireAuth, guard('CandidatesView'), asyncHandler(async (req,res)=>res.json(await service.listPotentialCandidates(req.query))));
// Backward-compatible alias for clients that used the original worklist.
router.get('/eligible', requireAuth, guard('CandidatesView'), asyncHandler(async (req,res)=>res.json(await service.listPotentialCandidates({ ...req.query, eligibilityStatus:'eligible' }))));
router.post('/applications', requireAuth, guard('ApplicationReview'), asyncHandler(async(req,res)=>{try{res.status(201).json(await service.createApplication(Number(req.body?.studentId),req.body||{},req.user));}catch(e){respond(res,e);}}));
router.get('/applications', requireAuth, guard('CandidatesView'), asyncHandler(async(req,res)=>{
  const clauses=['1=1'],params=[];if(req.query.status){clauses.push('ga.status=?');params.push(req.query.status);}if(req.query.termId){clauses.push('ga.expectedGraduationTermId=?');params.push(req.query.termId);}
  res.json(await all(`SELECT ga.*,u.name,u.idNumber,p.name programName,t.name expectedGraduationTerm FROM graduation_applications ga JOIN users u ON u.id=ga.studentId JOIN student_programs spr ON spr.id=ga.studentProgramId JOIN programs p ON p.id=spr.programId LEFT JOIN terms t ON t.id=ga.expectedGraduationTermId WHERE ${clauses.join(' AND ')} ORDER BY ga.id DESC`,params));
}));
router.patch('/applications/:id/status', requireAuth, guard('ApplicationReview'), asyncHandler(async(req,res)=>{try{res.json(await service.updateApplicationStatus(req.params.id,req.body?.status,req.body?.reason,req.user));}catch(e){respond(res,e);}}));
router.get('/applications/:id', requireAuth, guard('CandidatesView'), asyncHandler(async(req,res)=>{const row=await get('SELECT * FROM graduation_applications WHERE id=?',[req.params.id]);if(!row)return res.status(404).json({error:'Application not found.'});const audits=await all('SELECT id,result,purpose,snapshot,createdAt FROM graduation_audits WHERE graduationApplicationId=? ORDER BY id DESC',[row.id]);res.json({...row,audits:audits.map(a=>({...a,snapshot:JSON.parse(a.snapshot)}))});}));
router.post('/applications/:id/audit', requireAuth, guard('AuditRun'), asyncHandler(async(req,res)=>{const app=await get('SELECT * FROM graduation_applications WHERE id=?',[req.params.id]);if(!app)return res.status(404).json({error:'Application not found.'});try{res.json(await service.graduationAudit(app.studentId,{applicationId:app.id,actor:req.user,purpose:'decision',store:true}));}catch(e){respond(res,e);}}));
router.post('/applications/:id/finalize', requireAuth, explicitFinalizationGuard, asyncHandler(async(req,res)=>{try{const out=await service.finalizeGraduation(req.params.id,req.body||{},req.user);res.status(out.alreadyFinalized?200:201).json(out);}catch(e){respond(res,e);}}));
router.get('/audit/:studentId', requireAuth, guard('CandidatesView'), asyncHandler(async(req,res)=>{try{res.json(await service.graduationAudit(Number(req.params.studentId)));}catch(e){respond(res,e);}}));

// The original one-click conferral endpoint is intentionally closed: callers must create an
// application, complete its approval request, and invoke the final-validation endpoint above.
router.post('/confirm/:studentId', requireAuth, explicitFinalizationGuard, (_req,res)=>res.status(410).json({error:'Direct graduation confirmation has been retired. Use the graduation application and approval workflow.',code:'GRADUATION_WORKFLOW_REQUIRED'}));

router.get('/registry', requireAuth, guard('RegistryView'), asyncHandler(async(req,res)=>res.json(await service.listRegistry(req.query))));
router.get('/registry/:id', requireAuth, guard('RegistryView'), asyncHandler(async(req,res)=>{try{res.json(await service.getGraduate(req.params.id));}catch(e){respond(res,e);}}));
router.patch('/registry/:id/certificate', requireAuth, guard('CertificateManage'), asyncHandler(async(req,res)=>{try{res.json(await service.updateIssuance(req.params.id,'certificate',req.body||{},req.user));}catch(e){respond(res,e);}}));
router.patch('/registry/:id/transcript', requireAuth, guard('TranscriptManage'), asyncHandler(async(req,res)=>{try{res.json(await service.updateIssuance(req.params.id,'transcript',req.body||{},req.user));}catch(e){respond(res,e);}}));
router.post('/registry/:id/corrections', requireAuth, guard('Correct'), asyncHandler(async(req,res)=>{try{res.json(await service.correctRecord(req.params.id,req.body||{},req.user));}catch(e){respond(res,e);}}));
router.post('/registry/:id/revoke', requireAuth, guard('Correct'), asyncHandler(async(req,res)=>{try{res.json(await service.revokeRecord(req.params.id,req.body?.reason,req.user));}catch(e){respond(res,e);}}));
router.get('/reports', requireAuth, guard('ReportsView'), asyncHandler(async(_req,res)=>res.json(await service.reports())));
router.get('/reconciliation/preview', requireAuth, guard('Correct'), asyncHandler(async(_req,res)=>res.json(await service.reconciliationPreview())));
router.get('/policy', requireAuth, guard('CandidatesView'), asyncHandler(async(_req,res)=>{
  const row=await get("SELECT value FROM settings WHERE key='graduationMinimumGpa'");res.json({minimumGpa:row?.value==null?null:Number(row.value)});
}));
router.put('/policy', requireAuth, guard('ApplicationReview'), asyncHandler(async(req,res)=>{
  const minimumGpa=Number(req.body?.minimumGpa);if(!Number.isFinite(minimumGpa)||minimumGpa<0||minimumGpa>4)return res.status(400).json({error:'minimumGpa must be between 0 and 4.'});
  const old=await get("SELECT value FROM settings WHERE key='graduationMinimumGpa'");
  await run("INSERT INTO settings(key,value) VALUES('graduationMinimumGpa',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(minimumGpa)]);
  await logAudit(req.user,'graduation-policy-update','settings',null,null,{minimumGpa:old?.value??null},{minimumGpa});res.json({minimumGpa});
}));
router.put('/curricula/:curriculumId/requirements', requireAuth, guard('ApplicationReview'), asyncHandler(async(req,res)=>{
  const allowed=new Set(['thesis','capstone','internship','practicum','project']);const requirements=Array.isArray(req.body?.requirements)?req.body.requirements:[];
  for(const item of requirements){if(!allowed.has(item.requirementType)||!String(item.label||'').trim())return res.status(400).json({error:'Invalid graduation requirement.'});await run(`INSERT INTO graduation_requirements(curriculumId,requirementType,label,required) VALUES(?,?,?,?) ON CONFLICT(curriculumId,requirementType) DO UPDATE SET label=excluded.label,required=excluded.required`,[req.params.curriculumId,item.requirementType,item.label.trim(),item.required===false?0:1]);}
  await logAudit(req.user,'graduation-requirements-update','curriculum',Number(req.params.curriculumId),null,null,{requirements});res.json(await all('SELECT * FROM graduation_requirements WHERE curriculumId=? ORDER BY requirementType',[req.params.curriculumId]));
}));
router.patch('/applications/:id/requirements/:type', requireAuth, guard('ApplicationReview'), asyncHandler(async(req,res)=>{
  if(!['pending','completed','failed','waived'].includes(req.body?.status))return res.status(400).json({error:'Invalid requirement status.'});
  await run(`INSERT INTO graduation_requirement_results(graduationApplicationId,requirementType,status,evidence,verifiedBy,verifiedAt) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(graduationApplicationId,requirementType) DO UPDATE SET status=excluded.status,evidence=excluded.evidence,verifiedBy=excluded.verifiedBy,verifiedAt=CURRENT_TIMESTAMP,updatedAt=CURRENT_TIMESTAMP`,[req.params.id,req.params.type,req.body.status,req.body.evidence||null,req.user.sub]);
  await logAudit(req.user,'graduation-requirement-verify','graduation_applications',Number(req.params.id),{requirementType:req.params.type},null,{status:req.body.status,evidence:req.body.evidence||null});res.json({status:req.body.status});
}));

router.get('/registry-export.xlsx', requireAuth, guard('RegistryExport'), asyncHandler(async(req,res)=>{
  const result=await service.listRegistry({...req.query,page:1,pageSize:5000,export:true});
  const workbook=new ExcelJS.Workbook(), sheet=workbook.addWorksheet('Graduates Registry');
  sheet.columns=[['Graduate number','graduateNumber'],['Student number','idNumber'],['Full name','name'],['Program','programName'],['Degree awarded','degreeAwarded'],['Department','departmentName'],['College','collegeName'],['Curriculum','curriculumVersion'],['Official graduation date','officialGraduationDate'],['Term','graduationTerm'],['Final GPA','finalGpa'],['Completed credits','totalCreditsCompleted'],['Honors','honorsOrDistinction'],['Certificate status','certificateStatus'],['Transcript status','transcriptStatus'],['Record status','recordStatus']].map(([header,key])=>({header,key,width:22}));
  result.items.forEach(row=>sheet.addRow(row));sheet.getRow(1).font={bold:true};
  const buffer=await workbook.xlsx.writeBuffer();
  await logAudit(req.user,'graduation-registry-export','graduation_records',null,{filters:req.query,rowCount:result.items.length});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="graduates-registry.xlsx"');res.send(Buffer.from(buffer));
}));

router.get('/certificate/:studentId', requireAuth, asyncHandler(async(req,res)=>{
  const studentId=Number(req.params.studentId),isSelf=Number(req.user.sub)===studentId;
  if(!isSelf&&!can(req.user.role,'graduation','read'))return res.status(403).json({error:'Forbidden'});
  const record=await get(`SELECT * FROM graduation_records WHERE studentId=? AND finalizedAt IS NOT NULL AND COALESCE(recordStatus,'active')!='revoked' ORDER BY id DESC LIMIT 1`,[studentId]);
  if(!record)return res.status(404).json({error:'No finalized graduation record found for this student'});
  const student=await get('SELECT name,idNumber FROM users WHERE id=?',[studentId]);
  const buffer=await renderCertificate(student,record);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="certificate-${record.certificateNumber}.pdf"`);res.send(buffer);
}));

function renderCertificate(student,record){return new Promise((resolve,reject)=>{try{const doc=new PDFDocument({margin:50,size:'A4',layout:'landscape'}),chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);const {width,height}=doc.page;doc.rect(20,20,width-40,height-40).lineWidth(2).strokeColor('#4B7FE8').stroke();doc.font('Helvetica-Bold').fontSize(24).text('Certificate of Graduation',0,120,{align:'center'});doc.font('Helvetica').fontSize(12).text('This is to certify that',0,190,{align:'center'});doc.font('Helvetica-Bold').fontSize(28).fillColor('#4B7FE8').text(student?.name||'Unknown Student',0,215,{align:'center'});doc.fillColor('#000').font('Helvetica').fontSize(12).text('has been awarded',0,260,{align:'center'});doc.font('Helvetica-Bold').fontSize(18).text(record.degreeAwarded,0,285,{align:'center'});doc.font('Helvetica').fontSize(11).text(`Official graduation date: ${record.officialGraduationDate||record.graduationDate}`,0,325,{align:'center'});doc.fontSize(9).text(`Graduate No: ${record.graduateNumber}`,40,height-75).text(`Certificate No: ${record.certificateNumber}`,40,height-60).text(`Student No: ${student?.idNumber||''}`,40,height-45);doc.end();}catch(e){reject(e);}});}

module.exports=router;
