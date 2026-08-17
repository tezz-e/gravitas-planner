import React from 'react';
import './FAQModal.css';
import { X, HelpCircle, Database, ShieldAlert, Sparkles, RefreshCw, CalendarPlus, Share2 } from 'lucide-react';
import rawEvents from '../data/events_scored.json';

export default function FAQModal({ onClose }) {
  return (
    <div className="faq-overlay" onClick={onClose}>
      <div className="faq-modal animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="faq-header">
          <div className="faq-title-row">
            <HelpCircle size={22} className="faq-icon" />
            <h3>Gravitas '26 Planner — FAQ & Data Guide</h3>
          </div>
          <button className="faq-close-btn" onClick={onClose} aria-label="Close FAQ">
            <X size={18} />
          </button>
        </div>

        <div className="faq-body">
          <div className="faq-item">
            <h4><Sparkles size={16} /> How are recommendations calculated?</h4>
            <p>
              We calculate personalized match scores based on your <strong>ranked technical interests</strong> (Primary, Secondary, Tertiary). 
              Our recommendation matrix evaluates each event's core focus, organizing club history, and event type. Every card shows a transparent breakdown like <code>92% match · AI 70 · Web 18</code> so you know exactly why an event was ranked.
            </p>
          </div>

          <div className="faq-item">
            <h4><Database size={16} /> Where does this data come from?</h4>
            <p>
              Event details (dates, venues, club hosts, ticket prices, team sizes) are fetched directly from the official <strong>VIT Gravitas API dataset</strong> ({rawEvents.length} events index).
            </p>
          </div>

          <div className="faq-item">
            <h4><ShieldAlert size={16} /> Does this automatically register me for events?</h4>
            <p>
              <strong>No.</strong> This application is an independent student planning companion. To complete official registration and payments, click the <strong>"Official Registration"</strong> link on any event card to open the VIT portal.
            </p>
          </div>

          <div className="faq-item">
            <h4><CalendarPlus size={16} /> How do I get my plan into Google Calendar or Apple Calendar?</h4>
            <p>
              Click <strong>"Download Calendar (.ics)"</strong> to save a file with all your planned events.
            </p>
            <p>
              <strong>Apple Calendar (iPhone/iPad/Mac):</strong> just open the downloaded file — tapping it on iPhone/iPad, or double-clicking it on Mac, adds all the events straight away.
            </p>
            <p>
              <strong>Google Calendar:</strong> go to <code>calendar.google.com</code> on a computer → Settings (gear icon) → <strong>Import & Export</strong> → <strong>Import</strong> → choose the downloaded file → pick a calendar to add the events to. Google's mobile app doesn't support importing this file directly, so this step works best from a computer browser.
            </p>
            <p>
              Not comfortable with calendar apps? Use <strong>"Copy as Text"</strong> instead — it copies a clean list of your events with dates, times and venues that you can paste into Notes, WhatsApp, or anywhere else.
            </p>
          </div>

          <div className="faq-item">
            <h4><Share2 size={16} /> What does the "Share Plan" button do?</h4>
            <p>
              It copies a link that pre-loads <strong>your exact event selections</strong> for whoever opens it — useful for sending your plan to a friend so they can see (and start from) the same events. It's for sharing your picks with a person, not for exporting to a calendar app — use the <strong>.ics download</strong> or <strong>Copy as Text</strong> options above for that.
            </p>
          </div>

          <div className="faq-item">
            <h4><RefreshCw size={16} /> Data Verification Notice</h4>
            <p className="disclaimer-text">
              Event venues and slot times may be adjusted by organizing clubs leading up to Gravitas. Always double-check timings on the official Gravitas portal before attending.
            </p>
          </div>
        </div>

        <div className="faq-footer">
          <div className="faq-footer-info">
            <span>Dataset Version: <code>v1.4 • {rawEvents.length} Events Index</code></span>
          </div>
          <button className="faq-done-btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
