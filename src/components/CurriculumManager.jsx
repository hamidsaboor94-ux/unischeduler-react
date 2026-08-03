import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can } from '../permissions.js';
import { useToast } from '../context/ToastContext.jsx';
import { useNavigation } from '../context/NavigationContext.jsx';

export default function CurriculumManager({ programs, courses, currentUser }) {
  const { toast }=useToast(); const { activeSection }=useNavigation(); const canWrite=can(currentUser.role,'curriculum','write');
  const [items,setItems]=useState([]),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null);
  const [draft,setDraft]=useState({programId:'',name:'',catalogYear:'',totalRequiredCredits:''});
  const [semester,setSemester]=useState(1),[courseId,setCourseId]=useState('');
  const load=async()=>{const rows=await api('GET','/curricula');setItems(rows);if(!selected&&rows[0])setSelected(String(rows[0].id));};
  // AppShell keeps every page mounted. Fetch only when Departments is actually visible; this
  // also prevents Vite StrictMode from showing the same hidden-page error toast twice.
  useEffect(()=>{if(activeSection==='departments')load().catch(e=>toast(e.message,'error'));},[activeSection]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(selected)api('GET',`/curricula/${selected}`).then(setDetail).catch(e=>toast(e.message,'error'));else setDetail(null);},[selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh=async()=>{await load();if(selected)setDetail(await api('GET',`/curricula/${selected}`));};
  const act=async(fn,msg)=>{try{await fn();await refresh();toast(msg);}catch(e){toast(e.message,'error');}};
  const create=()=>act(async()=>{const x=await api('POST','/curricula',{...draft,programId:Number(draft.programId),totalRequiredCredits:draft.totalRequiredCredits?Number(draft.totalRequiredCredits):null});setSelected(String(x.id));setDraft({programId:'',name:'',catalogYear:'',totalRequiredCredits:''});},'Curriculum draft created.');
  const addSemester=()=>act(()=>api('POST',`/curricula/${selected}/semesters`,{semesterNumber:Number(semester),name:`Semester ${semester}` }),'Semester added.');
  const addCourse=()=>{const target=detail?.semesters.find(s=>Number(s.semesterNumber)===Number(semester));if(!target)return toast('Add that semester first.','warning');return act(()=>api('POST',`/curricula/${selected}/courses`,{curriculumSemesterId:target.id,courseId:Number(courseId),courseType:'required',recommendedSequence:target.courses.length+1}),'Course added.');};
  return <div className="panel" style={{marginTop:16}}>
    <div className="panel-header"><div><strong>Curriculum Versions</strong><div className="field-hint">Program → version → semester plan → courses and elective groups</div></div></div>
    <div style={{padding:14}}>
      {canWrite&&<div className="form-row-2"><select value={draft.programId} onChange={e=>setDraft({...draft,programId:e.target.value})}><option value="">Program…</option>{programs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input placeholder="Curriculum name" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/><input placeholder="Catalog year" value={draft.catalogYear} onChange={e=>setDraft({...draft,catalogYear:e.target.value})}/><input type="number" placeholder="Required credits" value={draft.totalRequiredCredits} onChange={e=>setDraft({...draft,totalRequiredCredits:e.target.value})}/><button className="btn-primary" disabled={!draft.programId||!draft.name.trim()} onClick={create}>Create draft</button></div>}
      <div className="form-row" style={{marginTop:12}}><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select curriculum…</option>{items.map(c=><option key={c.id} value={c.id}>{c.programName} — {c.name} ({c.catalogYear||'no year'})</option>)}</select></div>
      {detail&&<><div style={{display:'flex',gap:8,alignItems:'center',margin:'10px 0'}}><span className="pill">{detail.curriculum.status}</span><strong>{detail.curriculum.name}</strong><span className="field-hint">{detail.calculatedCredits} planned credits</span>{canWrite&&detail.curriculum.status==='draft'&&<><button className="btn-sm" onClick={()=>act(()=>api('POST',`/curricula/${selected}/validate`,{}),'Curriculum validated.')}>Validate</button><button className="btn-sm" onClick={()=>act(()=>api('POST',`/curricula/${selected}/activate`,{}),'Curriculum activated.')}>Activate</button></>}</div>
        {canWrite&&detail.curriculum.status==='draft'&&<div style={{display:'flex',gap:8,marginBottom:12}}><input type="number" min="1" value={semester} onChange={e=>setSemester(e.target.value)} style={{width:100}}/><button className="btn-sm" onClick={addSemester}>Add semester</button><select value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">Course…</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select><button className="btn-sm" disabled={!courseId} onClick={addCourse}>Add required course</button></div>}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Semester</th><th>Credits</th><th>Courses</th></tr></thead><tbody>{detail.semesters.map(s=><tr key={s.id}><td>{s.name||`Semester ${s.semesterNumber}`}</td><td>{s.totalCredits}</td><td>{s.courses.map(c=><span className="pill" key={c.id} style={{marginRight:5}}>{c.code} · {c.courseType}</span>)}</td></tr>)}</tbody></table></div>
      </>}
    </div>
  </div>;
}
