import React, { useState, useMemo, useEffect, useRef } from 'react';
import './EventExplorer.css';
import { formatEventTime, parseAPIDate } from '../utils/scoring';
import { Calendar, MapPin, Building, IndianRupee, Plus, Check, ExternalLink, ArrowRight, AlertTriangle, ShieldCheck, Sparkles, Layers, X } from 'lucide-react';

export default function EventExplorer({ 
  events = [], 
  selectedEvents = [], 
  myEvents = [],
  conflictPairsCount = 0,
  ignoredConflictKeys = [],
  onIgnoreConflict,
  sortMode = 'relevance',
  onTogglePlan, 
  onRemoveEventWithToast,
  onSelectEventDetail,
  onOpenFullPlan
}) {
  const [selectedDate, setSelectedDate] = useState('ALL');
  const [selectedWeekendTrack, setSelectedWeekendTrack] = useState('ALL');
  // A person can have a generally technical profile but want a completely
  // different kind of day. Store that intent against the specific date rather
  // than overwriting their long-term onboarding preferences.
  const [dayIntents, setDayIntents] = useState({});
  const daySectionRefs = useRef({});

  const getDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const DAY_INTENTS = [
    { id: 'all', label: 'All events' },
    { id: 'match', label: 'Best matches' },
    { id: 'fun', label: 'Fun & social' },
    { id: 'compete', label: 'Compete' },
    { id: 'learn', label: 'Learn' },
    { id: 'build', label: 'Build' },
  ];

  const getIntentScore = (event, intent) => {
    const scores = event.scores || {};
    const technicalScore = Math.max(scores.ai_ml || 0, scores.webdev || 0, scores.robotics || 0, scores.iot || 0, scores.electronics || 0);

    if (intent === 'fun') return scores.general_fun || 0;
    if (intent === 'compete') return (event.type === 'Competition' ? 100 : event.type === 'Hackathon' ? 85 : 0) + Math.max(scores.hackathons || 0, scores.cybersecurity || 0, scores.gaming || 0) / 100;
    if (intent === 'learn') return (event.type === 'Workshop' ? 100 : 0) + technicalScore / 100;
    if (intent === 'build') return (event.type === 'Hackathon' ? 100 : 0) + technicalScore / 100;
    return event.matchPercentage || 0;
  };

  const jumpToDate = (dateIso) => {
    setSelectedWeekendTrack('ALL');
    setSelectedDate(dateIso);
  };

  const selectedDayIntent = selectedDate === 'ALL' ? 'all' : (dayIntents[selectedDate] || 'all');

  const setSelectedDayIntent = (intent) => {
    if (selectedDate === 'ALL') return;
    setDayIntents(previous => ({ ...previous, [selectedDate]: intent }));
  };

  useEffect(() => {
    if (selectedDate === 'ALL') return;
    const target = daySectionRefs.current[selectedDate];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedDate, selectedWeekendTrack]);

  // Extract unique dates dynamically from event dataset
  const availableDates = useMemo(() => {
    const datesSet = new Set();
    events.forEach(e => {
      const d = parseAPIDate(e.start_date);
      if (d) {
        datesSet.add(getDateKey(d));
      }
    });
    return Array.from(datesSet).sort();
  }, [events]);

  // Compute Conflict Event IDs
  const conflictEventIds = useMemo(() => {
    const ids = new Set();
    const n = myEvents.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const startA = parseAPIDate(myEvents[i].start_date);
        const endA = parseAPIDate(myEvents[i].end_date) || new Date(startA.getTime() + 2 * 3600 * 1000);
        const startB = parseAPIDate(myEvents[j].start_date);
        const endB = parseAPIDate(myEvents[j].end_date) || new Date(startB.getTime() + 2 * 3600 * 1000);

        const conflictKey = [String(myEvents[i].id), String(myEvents[j].id)].sort().join('::');
        if (startA && startB && startA < endB && endA > startB && !ignoredConflictKeys.includes(conflictKey)) {
          ids.add(myEvents[i].id);
          ids.add(myEvents[j].id);
        }
      }
    }
    return ids;
  }, [myEvents, ignoredConflictKeys]);

  const firstConflictKey = useMemo(() => {
    for (let i = 0; i < myEvents.length; i++) {
      for (let j = i + 1; j < myEvents.length; j++) {
        const startA = parseAPIDate(myEvents[i].start_date);
        const endA = parseAPIDate(myEvents[i].end_date) || new Date(startA.getTime() + 2 * 3600 * 1000);
        const startB = parseAPIDate(myEvents[j].start_date);
        const endB = parseAPIDate(myEvents[j].end_date) || new Date(startB.getTime() + 2 * 3600 * 1000);
        const key = [String(myEvents[i].id), String(myEvents[j].id)].sort().join('::');
        if (startA && startB && startA < endB && endA > startB && !ignoredConflictKeys.includes(key)) return key;
      }
    }
    return null;
  }, [myEvents, ignoredConflictKeys]);

  // Filter events by selected weekend track & date
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      const d = parseAPIDate(e.start_date);
      if (!d) return false;
      const dateIso = getDateKey(d);

      // Track filtering
      if (selectedWeekendTrack === 'MAIN_WEEKEND') {
        if (!(dateIso >= '2026-09-18' && dateIso <= '2026-09-20')) return false;
      } else if (selectedWeekendTrack === 'PRE_FESTIVAL') {
        if (!(dateIso < '2026-09-18')) return false;
      } else if (selectedWeekendTrack === 'POST_FESTIVAL') {
        if (!(dateIso > '2026-09-20')) return false;
      } else if (selectedWeekendTrack === 'RECOMMENDED') {
        if ((e.matchPercentage || 0) < 70) return false;
      }

      return true;
    });
  }, [events, selectedWeekendTrack, selectedDate]);

  // Keep dates chronological, but rank the cards inside each date by the
  // selected sort. The old code re-sorted the entire stream by time and lost
  // the relevance order calculated in scoring.js.
  const eventsByDay = useMemo(() => {
    const groups = {};
    filteredEvents.forEach(event => {
      const d = parseAPIDate(event.start_date);
      const dateKey = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : 'DATE TBA';
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });

    const compareEvents = (a, b) => {
      const eventDate = parseAPIDate(a.start_date);
      const dayIntent = eventDate ? (dayIntents[getDateKey(eventDate)] || 'all') : 'all';

      // Date-specific intent takes priority for that one day only. The saved
      // profile still controls all other dates and the default order.
      if (dayIntent !== 'all') {
        return getIntentScore(b, dayIntent) - getIntentScore(a, dayIntent)
          || (b.matchPercentage || 0) - (a.matchPercentage || 0)
          || (parseAPIDate(a.start_date) || 0) - (parseAPIDate(b.start_date) || 0)
          || a.name.localeCompare(b.name);
      }
      if (sortMode === 'free') return (a.price || 0) - (b.price || 0) || b.matchPercentage - a.matchPercentage;
      if (sortMode === 'shortest') {
        const aDuration = (parseAPIDate(a.end_date) || parseAPIDate(a.start_date)) - parseAPIDate(a.start_date);
        const bDuration = (parseAPIDate(b.end_date) || parseAPIDate(b.start_date)) - parseAPIDate(b.start_date);
        return aDuration - bDuration || b.matchPercentage - a.matchPercentage;
      }
      if (sortMode === 'soonest') return (parseAPIDate(a.start_date) || 0) - (parseAPIDate(b.start_date) || 0);
      return (b.matchPercentage || 0) - (a.matchPercentage || 0)
        || (parseAPIDate(a.start_date) || 0) - (parseAPIDate(b.start_date) || 0)
        || a.name.localeCompare(b.name);
    };

    Object.values(groups).forEach(dayEvents => dayEvents.sort(compareEvents));

    return Object.fromEntries(
      Object.entries(groups).sort(([firstLabel, firstEvents], [secondLabel, secondEvents]) =>
        (parseAPIDate(firstEvents[0].start_date) || 0) - (parseAPIDate(secondEvents[0].start_date) || 0)
      )
    );
  }, [filteredEvents, sortMode, dayIntents]);

  // Group planned events chronologically by date for Right Tray
  const plannedEventsGroupedByDate = useMemo(() => {
    const sorted = [...myEvents].sort((a, b) => (parseAPIDate(a.start_date) || 0) - (parseAPIDate(b.start_date) || 0));
    const groups = {};

    sorted.forEach(event => {
      const d = parseAPIDate(event.start_date);
      const dateKey = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'DATE TBA';
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });

    return groups;
  }, [myEvents]);

  const totalCost = useMemo(() => myEvents.reduce((acc, curr) => acc + (curr.price || 0), 0), [myEvents]);

  return (
    <>
    <div className="festival-layout">
      {/* COLUMN 1: Vertical Date Rail */}
      <aside className="left-date-rail">
        <div className="rail-header mono-font">DATES & ITINERARY</div>
        
        <button 
          className={`date-rail-btn mono-font ${selectedDate === 'ALL' ? 'active' : ''}`}
          onClick={() => setSelectedDate('ALL')}
        >
          <span className="rail-date">ALL DATES</span>
          <span className="rail-count">{events.length}</span>
        </button>

        {availableDates.map(dateStr => {
          const dateObj = new Date(dateStr);
          const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const dayNum = String(dateObj.getDate()).padStart(2, '0');
          const count = events.filter(e => {
            const date = parseAPIDate(e.start_date);
            return date && getDateKey(date) === dateStr;
          }).length;
          const isMainFest = dateStr >= '2026-09-18' && dateStr <= '2026-09-20';

          return (
            <button 
              key={dateStr}
              className={`date-rail-btn mono-font ${selectedDate === dateStr ? 'active' : ''} ${isMainFest ? 'main-fest-date' : ''}`}
              onClick={() => jumpToDate(dateStr)}
            >
              <span className="rail-date">
                {isMainFest && '★ '}{monthStr} {dayNum}
              </span>
              <span className="rail-count">{count}</span>
            </button>
          );
        })}
      </aside>

      {/* COLUMN 2: Main Discovery & Full-Month Feed */}
      <main className="middle-feed-column">
        {/* Full-Month Festival & Weekend Planning Track Bar */}
        <section className="itinerary-track-bar">
          <div className="track-bar-header">
            <h2>Full-Month Festival Itinerary</h2>
            <span className="track-bar-sub mono-font">
              {events.length} EVENTS INDEXED · PRESERVED ACROSS ALL DATES
            </span>
          </div>

          <div className="weekend-tracks">
            <button 
              className={`track-btn mono-font ${selectedWeekendTrack === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedWeekendTrack('ALL')}
            >
              <Layers size={13} /> ALL DATES ({events.length})
            </button>

            <button 
              className={`track-btn main-fest-track mono-font ${selectedWeekendTrack === 'MAIN_WEEKEND' ? 'active' : ''}`}
              onClick={() => setSelectedWeekendTrack('MAIN_WEEKEND')}
            >
              ★ MAIN FESTIVAL (SEP 18–20)
            </button>

            <button 
              className={`track-btn mono-font ${selectedWeekendTrack === 'PRE_FESTIVAL' ? 'active' : ''}`}
              onClick={() => setSelectedWeekendTrack('PRE_FESTIVAL')}
            >
              PRE-FESTIVAL TRACKS
            </button>

            <button 
              className={`track-btn mono-font ${selectedWeekendTrack === 'POST_FESTIVAL' ? 'active' : ''}`}
              onClick={() => setSelectedWeekendTrack('POST_FESTIVAL')}
            >
              POST-FESTIVAL TRACKS
            </button>

            <button 
              className={`track-btn rec-track mono-font ${selectedWeekendTrack === 'RECOMMENDED' ? 'active' : ''}`}
              onClick={() => setSelectedWeekendTrack('RECOMMENDED')}
            >
              <Sparkles size={13} /> TOP MATCHES
            </button>
          </div>

        </section>

        {/* Day-Wise Grouped Stream */}
        <section className="day-stream-section">
          {Object.keys(eventsByDay).length === 0 ? (
            <div className="empty-stream">
              <Calendar size={32} />
              <p>No events found for this date or track filter.</p>
            </div>
          ) : (
            Object.entries(eventsByDay).map(([dayLabel, dayEvents]) => {
              const isMainWeekend = dayLabel.includes('SEP 18') || dayLabel.includes('SEP 19') || dayLabel.includes('SEP 20');
              const dayDate = parseAPIDate(dayEvents[0].start_date);
              const dayIso = dayDate ? getDateKey(dayDate) : dayLabel;
              const dayIntent = dayIntents[dayIso] || 'all';

              return (
                <div
                  key={dayLabel}
                  ref={(node) => {
                    if (node) daySectionRefs.current[dayIso] = node;
                  }}
                  className={`day-feed-block ${isMainWeekend ? 'main-weekend-block' : ''}`}
                >
                  <div className="day-feed-header">
                    <div className="day-title-row">
                      <h3>{dayLabel}</h3>
                      {isMainWeekend && <span className="main-weekend-badge mono-font">MAIN FESTIVAL WEEKEND</span>}
                      {dayEvents.length >= 3 && (
                        <label className="day-intent-select mono-font">
                          <span>SHOW ME</span>
                          <select
                            value={dayIntent}
                            onChange={(event) => setDayIntents(previous => ({ ...previous, [dayIso]: event.target.value }))}
                            aria-label={`What are you looking for on ${dayLabel}?`}
                          >
                            {DAY_INTENTS.map(intent => (
                              <option key={intent.id} value={intent.id}>{intent.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <span className="mono-font">{dayEvents.length} EVENTS</span>
                  </div>

                  <div className="feed-cards-grid">
                    {dayEvents.map(event => {
                      const isAdded = selectedEvents.includes(event.id);
                      const officialUrl = event.official_url || event.registration_url || `https://gravitas.vit.ac.in/events/${event.id}`;
                      const matchTopics = event.relevanceBreakdown ? event.relevanceBreakdown.slice(0, 2).join(' · ') : 'Match';

                      return (
                        <div 
                          key={event.id}
                          className={`festival-card ${isAdded ? 'selected' : ''}`}
                          onClick={() => onSelectEventDetail(event)}
                        >
                          <div className="card-header-line">
                            <span className="card-type-tag mono-font">{event.type || 'Event'}</span>
                            <span className="card-match-reason mono-font">
                              {matchTopics} · {event.matchPercentage || 75}%
                            </span>
                          </div>

                          <h3 className="card-name-title">{event.name}</h3>
                          <div className="card-club-row mono-font"><Building size={12} /> {event.club}</div>

                          <div className="card-metadata-grid mono-font">
                            <div className="meta-item">
                              <Calendar size={12} /> {formatEventTime(event.start_date, event.end_date)}
                            </div>
                            <div className="meta-item">
                              <MapPin size={12} /> {event.venue || 'TBA'}
                            </div>
                            <div className="meta-item">
                              <IndianRupee size={12} /> {event.price === 0 ? 'FREE' : `${event.price}`}
                            </div>
                          </div>

                          <div className="card-action-bar">
                            <button 
                              className={`card-primary-add mono-font ${isAdded ? 'added' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePlan(event.id);
                              }}
                            >
                              {isAdded ? (
                                <><Check size={14} /> IN MY PLAN</>
                              ) : (
                                <><Plus size={14} /> ADD TO PLAN</>
                              )}
                            </button>

                            <a 
                              href={officialUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="card-link-btn mono-font"
                              onClick={(e) => e.stopPropagation()}
                            >
                              OFFICIAL <ExternalLink size={11} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>

      {/* COLUMN 3: Live Editable "My Plan" Tray */}
      <aside className="right-plan-drawer">
        <div className="editable-plan-tray">
          {/* Header Row */}
          <div className="tray-header">
            <h3>MY PLAN</h3>
            <span className="tray-meta mono-font">
              {myEvents.length} {myEvents.length === 1 ? 'event' : 'events'} · ₹{totalCost}
            </span>
          </div>

          {/* Conflict Warning */}
          {conflictPairsCount > 0 && (
            <div className="tray-conflict-warning mono-font">
              <span><AlertTriangle size={14} /> {conflictPairsCount} CLASH DETECTED</span>
              {firstConflictKey && (
                <button onClick={() => onIgnoreConflict?.(firstConflictKey)}>
                  Ignore
                </button>
              )}
            </div>
          )}

          {/* Grouped Chronological List */}
          <div className="tray-items-scroll">
            {myEvents.length === 0 ? (
              <div className="empty-tray-msg mono-font">
                Your plan is empty. Add events while browsing.
              </div>
            ) : (
              Object.entries(plannedEventsGroupedByDate).map(([dateLabel, items]) => (
                <div key={dateLabel} className="tray-date-group">
                  <div className="tray-date-label mono-font">{dateLabel}</div>
                  <div className="tray-group-items">
                    {items.map(event => {
                      const hasConflict = conflictEventIds.has(event.id);

                      return (
                        <div 
                          key={event.id}
                          className={`tray-item-row ${hasConflict ? 'has-conflict' : ''}`}
                          onClick={() => onSelectEventDetail(event)}
                        >
                          <div className="tray-item-info">
                            <span className="tray-item-title">{event.name}</span>
                            <span className="tray-item-time mono-font">
                              {formatEventTime(event.start_date, event.end_date)}
                              {event.venue ? ` · ${event.venue}` : ''}
                            </span>
                          </div>

                          <button 
                            className="tray-item-remove-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onRemoveEventWithToast) {
                                onRemoveEventWithToast(event);
                              } else {
                                onTogglePlan(event.id);
                              }
                            }}
                            title={`Remove ${event.name} from plan`}
                            aria-label={`Remove ${event.name} from plan`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Primary Action Button */}
          <button className="tray-full-calendar-btn mono-font" onClick={onOpenFullPlan}>
            View full calendar <ArrowRight size={15} />
          </button>
        </div>
      </aside>
    </div>

    {/* Mobile-only sticky summary bar. Hidden on desktop by default in CSS;
        only appears under the mobile breakpoint so it never touches the
        desktop layout. Reuses the same onOpenFullPlan handler as the desktop
        tray's "View full calendar" button. */}
    {myEvents.length > 0 && (
      <button className="mobile-plan-bar" onClick={onOpenFullPlan} aria-label="View my plan">
        <div className="mobile-plan-bar-info">
          <span className="mobile-plan-count">{myEvents.length} {myEvents.length === 1 ? 'event' : 'events'} added</span>
          <span className="mobile-plan-cost mono-font">₹{totalCost}</span>
        </div>
        {conflictPairsCount > 0 && (
          <span className="mobile-plan-conflict-badge mono-font">
            <AlertTriangle size={12} /> {conflictPairsCount}
          </span>
        )}
        <span className="mobile-plan-cta mono-font">View Plan <ArrowRight size={14} /></span>
      </button>
    )}
    </>
  );
}
