import { db } from '../db';
import { generateId } from '../helpers';
import { escapeHtml, escapeRegex } from '../helpers';
import type { EmailTemplate } from '../../types';

interface TemplateData {
  [key: string]: string;
}

interface RenderedTemplate {
  html: string;
  subject: string;
}

export class TemplateEngine {
  renderTemplate(template: EmailTemplate, data: TemplateData): RenderedTemplate {
    let html = template.htmlContent;
    let subject = template.subject;

    for (const key of Object.keys(data)) {
      const regex = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
      // H4: escape everything except paymentLink (it's a URL, not user content)
      const safeValue = key === 'paymentLink' ? data[key] : escapeHtml(data[key]);
      html = html.replace(regex, safeValue);
      subject = subject.replace(regex, escapeHtml(data[key]));
    }

    return { html, subject };
  }

  getTemplateById(templateId: string): EmailTemplate | undefined {
    return db.emailTemplates.get(templateId);
  }

  createTemplate(templateData: Omit<EmailTemplate, 'id'>): EmailTemplate {
    const template: EmailTemplate = {
      id: generateId('template'),
      ...templateData,
    };
    db.emailTemplates.set(template.id, template);
    return template;
  }
}
