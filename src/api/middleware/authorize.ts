import { Request, Response, NextFunction } from 'express';
import { db } from '../db';

export function authorizePractice(req: Request, res: Response, next: NextFunction) {
  const { practiceId } = req.params;
  if (req.role !== 'platform_admin' && req.practiceId !== practiceId) {
    return res.status(403).json({ error: 'Access denied: you do not own this resource.' });
  }
  next();
}

export function authorizePatient(req: Request, res: Response, next: NextFunction) {
  const patient = db.patients.get(req.params.patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  if (req.role !== 'platform_admin' && req.practiceId !== patient.practiceId) {
    return res.status(403).json({ error: 'Access denied: patient belongs to another practice.' });
  }
  req.patient = patient;
  next();
}
