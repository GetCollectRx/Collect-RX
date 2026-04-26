import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';

export const schemas = {
  sendEmail: Joi.object({
    workflowId: Joi.string().required(),
  }),

  paymentPlan: Joi.object({
    monthlyAmount: Joi.number().positive().precision(2).max(50000).required(),
    numberOfMonths: Joi.number().integer().min(1).max(60).required(),
  }),

  stripeWebhook: Joi.object({
    patient_id: Joi.string().required(),
    practice_id: Joi.string().required(),
    amount: Joi.number().positive().required(),
    payment_intent: Joi.string().required(),
  }).unknown(true),

  paginationQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(50),
    status: Joi.string()
      .valid('all', 'pending_payment', 'payment_plan', 'responsive', 'needs_attention', 'paid')
      .default('all'),
    search: Joi.string().max(200).allow('').default(''),
  }).unknown(true),
};

export function validate(schema: Joi.Schema, source: 'body' | 'query' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const target = source === 'body' ? req.body : req.query;
    const { error, value } = schema.validate(target, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    if (source === 'body') req.body = value;
    else req.query = value;
    next();
  };
}
