import { useEffect, useMemo, useState } from 'react';
import Section from '../components/Section.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useModal } from '../context/ModalContext.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { createGraduationApplication, fetchGraduationCandidates, finalizeGraduation, runGraduationAudit, updateGraduationApplicationStatus } from '../api.js';

const tone = { eligible:'pill-green', conditionally_eligible:'pill-amber', ineligible:'pill-red', approved:'pill-green', under_review:'pill-blue', corrections_required:'pill-amber', rejected:'pill-red', finalized:'pill-green' };

export default function GraduationCandidatesPage(){
  const {activeSection}=useNavigation(),{toast}=useToast(),{confirmAction}=useModal();
  const {currentUser}=useAppData();
  const canFinalize=['registrar','records_officer'].includes(currentUser.role);
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(null),[audit,setAudit]=useState(null);
  const [filters,setFilters]=useState({eligibilityStatus:'',applicationStatus:'',holdsPresent:''});
  const load=async()=>{setLoading(true);try{setRows(await fetchGraduationCandidates(filters));}catch(e){toast(e.message,'error');}finally{setLoading(false);}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(activeSection==='graduation-candidates')load();},[activeSection,filters.eligibilityStatus,filters.applicationStatus,filters.holdsPresent]);
  const counts=useMemo(()=>rows.reduce((a,r)=>({...a,[r.eligibilityStatus]:(a[r.eligibilityStatus]||0)+1}),{}),[rows]);
  const act=async(id,fn)=>{setBusy(id);try{await fn();await load();}catch(e){toast(e.message,'error');}finally{setBusy(null);}};
  const evaluate=row=>act(row.studentId,async()=>{if(!row.application)throw new Error('Mark this student as a candidate first.');const result=await runGraduationAudit(row.application.id);setAudit(result);toast(`Evaluation completed: ${result.result.replaceAll('_',' ')}`);});
  const mark=row=>act(row.studentId,async()=>{await createGraduationApplication({studentId:row.studentId});toast(`${row.name} was added to the graduation review workflow.`);});
  const requestCorrection=row=>{const reason=window.prompt('Correction request reason');if(reason)act(row.studentId,()=>updateGraduationApplicationStatus(row.application.id,'corrections_required',reason));};
  const reject=row=>{const reason=window.prompt('Rejection reason');if(reason)act(row.studentId,()=>updateGraduationApplicationStatus(row.application.id,'rejected',reason));};
  const finalize=row=>confirmAction(`Run final validation and finalize graduation for ${row.name}?`,()=>act(row.studentId,async()=>{const out=await finalizeGraduation(row.application.id);toast(`Graduation finalized: ${out.record.graduateNumber}`);}), 'Finalize graduation');
  return <Section name="graduation-candidates">
    <div className="topbar"><i className="ti ti-user-check" aria-hidden="true"></i><h2>Graduation Candidates</h2><div className="topbar-actions"><button className="btn-sm" onClick={load}><i className="ti ti-refresh"></i> Run eligibility evaluation</button></div></div>
    <div id="content">
      <div className="stat-grid" style={{marginBottom:16}}><div className="panel" style={{padding:14}}><strong>{rows.length}</strong><div className="field-hint">Potential candidates</div></div><div className="panel" style={{padding:14}}><strong>{counts.eligible||0}</strong><div className="field-hint">Eligible</div></div><div className="panel" style={{padding:14}}><strong>{counts.ineligible||0}</strong><div className="field-hint">Blocked</div></div></div>
      <div className="panel" style={{padding:14,marginBottom:16}}><div className="form-row-3">
        <label className="form-row"><span className="form-label">Eligibility</span><select value={filters.eligibilityStatus} onChange={e=>setFilters(f=>({...f,eligibilityStatus:e.target.value}))}><option value="">All</option><option value="eligible">Eligible</option><option value="conditionally_eligible">Conditionally eligible</option><option value="ineligible">Ineligible</option></select></label>
        <label className="form-row"><span className="form-label">Application</span><select value={filters.applicationStatus} onChange={e=>setFilters(f=>({...f,applicationStatus:e.target.value}))}><option value="">All</option><option value="under_review">Under review</option><option value="corrections_required">Corrections required</option><option value="approved">Approved</option><option value="finalized">Finalized</option></select></label>
        <label className="form-row"><span className="form-label">Holds</span><select value={filters.holdsPresent} onChange={e=>setFilters(f=>({...f,holdsPresent:e.target.value}))}><option value="">All</option><option value="true">Holds present</option></select></label>
      </div></div>
      {audit&&<div className="panel" style={{padding:14,marginBottom:16,borderInlineStart:`4px solid ${audit.eligible?'var(--success)':'var(--danger)'}`}}><div className="panel-header"><div><div className="panel-title">Graduation audit: {audit.student.name}</div><div className="field-hint">{audit.result.replaceAll('_',' ')} · GPA {audit.academic.gpa??'—'} · {audit.academic.completedCredits}/{audit.academic.requiredCredits} credits</div></div><button className="icon-btn" onClick={()=>setAudit(null)}><i className="ti ti-x"></i></button></div>{audit.reasons.length===0?<div className="pill pill-green">All configured requirements passed</div>:<ul>{audit.reasons.map((r,i)=><li key={`${r.code}-${i}`}><strong>{r.code.replaceAll('_',' ')}</strong>: {r.message}</li>)}</ul>}</div>}
      <div className="panel" style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>Student</th><th>Program / curriculum</th><th>Progress</th><th>GPA</th><th>Missing</th><th>Holds</th><th>Eligibility</th><th>Application</th><th>Actions</th></tr></thead><tbody>
        {loading?<tr><td colSpan="9" className="field-hint">Evaluating real academic records…</td></tr>:rows.length===0?<tr><td colSpan="9" className="field-hint">No candidates match these filters.</td></tr>:rows.map(row=><tr key={row.studentId}><td><strong>{row.name}</strong><div className="field-hint">{row.idNumber||'—'} · Semester {row.programSemester||'—'}</div></td><td>{row.programName||'—'}<div className="field-hint">{row.curriculumName||'No curriculum assigned'}</div></td><td>{row.completedCredits}/{row.requiredCredits}</td><td>{row.gpa??'—'}</td><td>{row.missingRequiredCount} required · {row.missingElectiveCount} elective</td><td>{row.holds.length?<span className="pill pill-red">{row.holds.length} active</span>:<span className="pill pill-green">Clear</span>}</td><td><span className={`pill ${tone[row.eligibilityStatus]||'pill-gray'}`}>{row.eligibilityStatus.replaceAll('_',' ')}</span></td><td>{row.application?<span className={`pill ${tone[row.application.status]||'pill-gray'}`}>{row.application.status.replaceAll('_',' ')}</span>:<span className="field-hint">Not applied</span>}</td><td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{!row.application&&<button className="btn-sm" disabled={busy===row.studentId} onClick={()=>mark(row)}>Mark candidate</button>}{row.application&&<button className="btn-sm" disabled={busy===row.studentId} onClick={()=>evaluate(row)}>View audit</button>}{row.application?.status==='under_review'&&<button className="btn-sm" onClick={()=>requestCorrection(row)}>Corrections</button>}{row.application?.status==='under_review'&&<button className="btn-sm danger" onClick={()=>reject(row)}>Reject</button>}{row.application?.status==='approved'&&canFinalize&&<button className="btn-primary" onClick={()=>finalize(row)}>Finalize</button>}</div></td></tr>)}
      </tbody></table></div>
    </div>
  </Section>;
}
