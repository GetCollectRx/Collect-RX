import { useState } from 'react';
import * as Icons from './Icons';
import { formatCurrency } from '../utils/format';

interface Procedure {
  id: number;
  code: string;
  name: string;
  fee: number;
}

export function EstimatesPage() {
  const [patient, setPatient] = useState('');
  const [procedures, setProcedures] = useState<Procedure[]>([
    { id: 1, code: 'D1110', name: 'Adult Prophylaxis', fee: 150 },
    { id: 2, code: 'D0120', name: 'Periodic Oral Evaluation', fee: 65 },
  ]);
  const [insuranceCoverage] = useState(80);
  const [annualMax] = useState(1500);
  const [usedBenefits] = useState(450);

  const totalFee = procedures.reduce((s, p) => s + p.fee, 0);
  const insuranceCovers = Math.round(totalFee * (insuranceCoverage / 100));
  const patientOwes = totalFee - insuranceCovers;
  const remainingBenefits = annualMax - usedBenefits;
  const exceedsMax = insuranceCovers > remainingBenefits;

  const addProcedure = () =>
    setProcedures([...procedures, { id: Date.now(), code: '', name: '', fee: 0 }]);

  const updateProcedure = (id: number, field: keyof Procedure, value: string) =>
    setProcedures(procedures.map((p) =>
      p.id === id ? { ...p, [field]: field === 'fee' ? Number(value) : value } : p
    ));

  const removeProcedure = (id: number) =>
    setProcedures(procedures.filter((p) => p.id !== id));

  return (
    <>
      <div className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Treatment Estimate</h1>
            <p className="page-subtitle">Create patient treatment estimates with insurance breakdown</p>
          </div>
          <button className="btn btn-primary"><Icons.Printer /> Print Estimate</button>
        </div>
      </div>

      <div className="page-content">
        <div className="estimate-builder">
          <div>
            <div className="section" style={{ marginBottom: '24px' }}>
              <div className="section-content padded">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Patient</label>
                  <select className="form-select" value={patient} onChange={(e) => setPatient(e.target.value)}>
                    <option value="">Select a patient...</option>
                    <option value="sarah">Sarah Johnson</option>
                    <option value="michael">Michael Chen</option>
                    <option value="emily">Emily Rodriguez</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-header">
                <h3 className="section-title">Procedures</h3>
                <button className="btn btn-secondary btn-sm" onClick={addProcedure}>
                  <Icons.Plus /> Add Procedure
                </button>
              </div>
              <div className="section-content">
                <div style={{ padding: '12px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                  <div className="procedure-item" style={{ padding: 0, border: 'none', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', color: 'var(--gray-500)' }}>
                    <span>CDT Code</span><span>Description</span><span>Fee</span><span />
                  </div>
                </div>
                {procedures.map((proc) => (
                  <div key={proc.id} className="procedure-item">
                    <input type="text" className="form-input" placeholder="D0000" value={proc.code}
                      style={{ fontFamily: 'monospace' }}
                      onChange={(e) => updateProcedure(proc.id, 'code', e.target.value)} />
                    <input type="text" className="form-input" placeholder="Procedure name" value={proc.name}
                      onChange={(e) => updateProcedure(proc.id, 'name', e.target.value)} />
                    <input type="number" className="form-input" placeholder="0" value={proc.fee || ''}
                      onChange={(e) => updateProcedure(proc.id, 'fee', e.target.value)} />
                    <button className="btn btn-ghost btn-icon" onClick={() => removeProcedure(proc.id)}>
                      <Icons.Trash />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="estimate-summary">
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '20px' }}>Estimate Summary</h3>

            <div className="estimate-row">
              <span className="estimate-label">Total Fees</span>
              <span className="estimate-value">{formatCurrency(totalFee)}</span>
            </div>
            <div className="estimate-row">
              <span className="estimate-label">Insurance Coverage ({insuranceCoverage}%)</span>
              <span className="estimate-value" style={{ color: 'var(--success)' }}>-{formatCurrency(insuranceCovers)}</span>
            </div>
            <div className="estimate-row total">
              <span className="estimate-label">Patient Responsibility</span>
              <span className="estimate-value" style={{ color: 'var(--brand-primary)' }}>{formatCurrency(patientOwes)}</span>
            </div>

            <div style={{ marginTop: '24px', padding: '16px', background: 'var(--gray-50)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginBottom: '4px' }}>Annual Maximum</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500 }}>{formatCurrency(usedBenefits)} used</span>
                <span style={{ fontSize: '14px', fontWeight: 500 }}>{formatCurrency(remainingBenefits)} remaining</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill primary" style={{ width: `${(usedBenefits / annualMax) * 100}%` }} />
              </div>
            </div>

            {exceedsMax && (
              <div className="max-warning">
                <Icons.AlertTriangle />
                <div className="max-warning-text">
                  <strong>Exceeds remaining benefits.</strong> The estimated insurance portion ({formatCurrency(insuranceCovers)}) exceeds the patient's remaining annual maximum ({formatCurrency(remainingBenefits)}).
                </div>
              </div>
            )}

            <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="btn btn-primary" style={{ width: '100%' }}><Icons.Printer /> Print for Patient</button>
              <button className="btn btn-secondary" style={{ width: '100%' }}><Icons.Mail /> Email to Patient</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
