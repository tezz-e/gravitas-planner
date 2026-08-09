import React, { useState, useMemo, useRef, useEffect } from 'react';
import './CalendarView.css';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { toFullCalendarEvent, parseAPIDate, formatEventTime, getTypeColor } from '../utils/scoring';
import { exportEventsToICS } from '../utils/exportICS';
import { copyPlanAsText } from '../utils/exportText';
import rawEvents from '../data/events_scored.json';
import { Calendar, List, Clock, AlertTriangle, Download, Share2, ClipboardList, Check, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

// Helper to get start of week (Sunday)
function getStartOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day;
  return new Date(date.setDate(diff));
}

// Helper to format YYYY-MM-DD
function toIsoDate(d) {
  // Event times are already normalised to IST by parseAPIDate. Avoid
  // toISOString() here because it can move date-only UI state into the
  // preceding UTC day.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatTimeOnly(dateStr) {
  const d = parseAPIDate(dateStr);
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// The Agenda tab is backed by FullCalendar's `list` view type, but a plain
// 'listWeek' only ever renders the single week containing the focused date
// - so a plan with events spread across the festival showed a badge of 9
// while the list itself displayed 2. We register a custom view ('listPlan')
// with a fixed visibleRange covering the whole festival so Agenda always
// lists every planned event regardless of which date happens to be focused.
function getFcViewType(viewMode) {
  return viewMode === 'listWeek' ? 'listPlan' : viewMode;
}

// Mobile Week Timeline doesn't go through FullCalendar at all (see the
// mobileWeekColumns memo + render branch below) — it's a small custom grid
// that shrinks empty days down to a thin tappable strip instead of forcing
// all 7 real-width columns onto a phone screen.
const MOBILE_WEEK_HOUR_START = 6;
const MOBILE_WEEK_HOUR_END = 24;
const MOBILE_WEEK_ROW_HEIGHT = 40;

function formatHourLabel(hour) {
  if (hour === 0 || hour === 24) return '12am';
  if (hour === 12) return '12pm';
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`;
}

// Tracks viewport width so the Festival Overview can render a genuinely
// different (not just CSS-squished) layout on mobile: a flat agenda list
// with empty-day runs collapsed, instead of the desktop's 7-col week grid.
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function CalendarView({ 
  myEvents = [], 
  onRemoveEvent, 
  onSelectEventDetail,
  onSharePlan,
  ignoredConflictKeys = [],
  onIgnoreConflict,
  onRestoreIgnoredConflicts
}) {
  const [viewMode, setViewMode] = useState('overview'); // 'overview' | 'timeGridDay' | 'listWeek' | 'timeGridWeek'
  const [focusedDate, setFocusedDate] = useState('2026-08-28');
  const [filterConflictsOnly, setFilterConflictsOnly] = useState(false);
  const [conflictIndex, setConflictIndex] = useState(0);
  const [copiedText, setCopiedText] = useState(false);
  const copiedTextTimerRef = useRef(null);

  const handleCopyPlanAsText = async () => {
    if (myEvents.length === 0) return;
    const ok = await copyPlanAsText(myEvents);
    if (ok) {
      setCopiedText(true);
      if (copiedTextTimerRef.current) clearTimeout(copiedTextTimerRef.current);
      copiedTextTimerRef.current = setTimeout(() => setCopiedText(false), 2500);
    }
  };

  const calendarRef = useRef(null);
  const firstWeekRef = useRef(null);

  // Compute Universal Schedule Conflicts & Conflict Dates
  const conflictPairs = useMemo(() => {
    const pairs = [];
    const n = myEvents.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const eventA = myEvents[i];
        const eventB = myEvents[j];

        const startA = parseAPIDate(eventA.start_date);
        const endA = parseAPIDate(eventA.end_date) || new Date(startA.getTime() + 2 * 3600 * 1000);
        const startB = parseAPIDate(eventB.start_date);
        const endB = parseAPIDate(eventB.end_date) || new Date(startB.getTime() + 2 * 3600 * 1000);

        if (startA && startB && startA < endB && endA > startB) {
          pairs.push({
            key: [String(eventA.id), String(eventB.id)].sort().join('::'),
            eventA,
            eventB,
            overlapStart: new Date(Math.max(startA.getTime(), startB.getTime())),
            overlapEnd: new Date(Math.min(endA.getTime(), endB.getTime())),
          });
        }
      }
    }

    return pairs;
  }, [myEvents]);

  const activeConflictPairs = useMemo(() => (
    conflictPairs.filter(pair => !ignoredConflictKeys.includes(pair.key))
  ), [conflictPairs, ignoredConflictKeys]);

  const conflictEventIds = useMemo(() => {
    const ids = new Set();
    activeConflictPairs.forEach(({ eventA, eventB }) => {
      ids.add(eventA.id);
      ids.add(eventB.id);
    });
    return ids;
  }, [activeConflictPairs]);

  const conflictDates = useMemo(() => {
    const datesSet = new Set();
    activeConflictPairs.forEach(({ overlapStart }) => {
      if (overlapStart) datesSet.add(toIsoDate(overlapStart));
    });
    return Array.from(datesSet).sort();
  }, [activeConflictPairs]);

  const conflictDateSet = useMemo(() => new Set(conflictDates), [conflictDates]);

  // Dynamic range computation for Festival Overview
  const festivalWeeks = useMemo(() => {
    // Derive both ends of the grid from the actual dataset instead of
    // hardcoded dates. Fixes two things: early-fest events (Aug 21 CTF)
    // getting a visible cell, and a dead trailing week of empty cells
    // rendering after the festival has actually ended.
    let earliestIso = '2026-08-28';
    let latestIso = '2026-08-28';
    rawEvents.forEach(e => {
      const d = parseAPIDate(e.start_date);
      if (d) {
        const iso = toIsoDate(d);
        if (iso < earliestIso) earliestIso = iso;
        if (iso > latestIso) latestIso = iso;
      }
    });
    const startIso = earliestIso;
    const endIso = latestIso;

    const startDate = new Date(startIso);
    const endDate = new Date(endIso);
    const visibleStart = getStartOfWeek(startDate); // Sun Aug 23, 2026
    
    const weeks = [];
    let current = new Date(visibleStart);
    let lastHeaderMonthKey = null;

    while (current <= endDate || current.getDay() !== 0) {
      const weekDays = [];

      // Label a row by the month its own Sunday falls in, not by whichever
      // day inside the row happens to be the 1st — a week spanning a real
      // month boundary (e.g. Sun Sep27–Sat Oct3) was previously getting
      // labeled "OCTOBER" even though most of its days were in September.
      const rowMonthKey = `${current.getFullYear()}-${current.getMonth()}`;
      let monthName = null;
      if (rowMonthKey !== lastHeaderMonthKey) {
        monthName = current.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
        lastHeaderMonthKey = rowMonthKey;
      }

      for (let i = 0; i < 7; i++) {
        const dayIso = toIsoDate(current);

        weekDays.push({
          dateObj: new Date(current),
          dateIso: dayIso,
          dayNum: current.getDate(),
          monthName: current.toLocaleDateString('en-US', { month: 'short' }),
          isMainWeekend: dayIso >= '2026-09-18' && dayIso <= '2026-09-20'
        });

        current.setDate(current.getDate() + 1);
      }

      weeks.push({
        weekId: weekDays[0].dateIso,
        days: weekDays,
        monthHeader: monthName
      });

      if (current > endDate && current.getDay() === 0) break;
    }

    return weeks;
  }, []);

  // Fixed date range the Agenda (listPlan) view is locked to, spanning the
  // whole derived festivalWeeks grid so every planned event shows up no
  // matter which single date is currently "focused".
  const agendaVisibleRange = useMemo(() => {
    if (festivalWeeks.length === 0) return null;
    const firstDay = festivalWeeks[0].days[0];
    const lastWeek = festivalWeeks[festivalWeeks.length - 1];
    const lastDay = lastWeek.days[lastWeek.days.length - 1];
    const endExclusive = new Date(lastDay.dateObj);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return { start: firstDay.dateIso, end: toIsoDate(endExclusive) };
  }, [festivalWeeks]);

  // Map events to dateIso for day cells (Multi-day events span across every day they run!)
  const eventsByDate = useMemo(() => {
    const plannedMap = {};
    const availableCountMap = {};

    // Available events count
    rawEvents.forEach(e => {
      const d = parseAPIDate(e.start_date);
      if (d) {
        const iso = toIsoDate(d);
        availableCountMap[iso] = (availableCountMap[iso] || 0) + 1;
      }
    });

    // Multi-day planned events span across all active days
    myEvents.forEach(e => {
      const start = parseAPIDate(e.start_date);
      const end = parseAPIDate(e.end_date) || start;
      if (!start) return;

      const cur = new Date(start);
      const endDay = new Date(end);

      while (cur <= endDay) {
        const iso = toIsoDate(cur);
        if (!plannedMap[iso]) plannedMap[iso] = [];
        if (!plannedMap[iso].some(item => item.id === e.id)) {
          plannedMap[iso].push(e);
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    return { plannedMap, availableCountMap };
  }, [myEvents]);

  const isMobile = useIsMobile(768);

  // Mobile-only compressed Week Timeline: gives days with planned events
  // real width and shrinks empty days down to a thin tappable strip, so all
  // 7 days fit without forcing horizontal scroll through empty space.
  // Segments are clipped to the same 6am–midnight window the desktop Week
  // Timeline uses (slotMinTime/slotMaxTime on the FullCalendar instance).
  const mobileWeekColumns = useMemo(() => {
    if (!isMobile || viewMode !== 'timeGridWeek') return [];
    const weekStart = getStartOfWeek(fromIsoDate(focusedDate));

    return Array.from({ length: 7 }).map((_, i) => {
      const dateObj = new Date(weekStart);
      dateObj.setDate(dateObj.getDate() + i);
      const dateIso = toIsoDate(dateObj);

      const windowStart = new Date(dateObj);
      windowStart.setHours(MOBILE_WEEK_HOUR_START, 0, 0, 0);
      const windowEnd = new Date(dateObj);
      windowEnd.setDate(windowEnd.getDate() + 1);
      windowEnd.setHours(0, 0, 0, 0);

      // Clip every planned event touching this day to the visible window,
      // then assign side-by-side lanes to anything that overlaps in time.
      const segments = [];
      myEvents.forEach(e => {
        const start = parseAPIDate(e.start_date);
        const end = parseAPIDate(e.end_date) || (start && new Date(start.getTime() + 2 * 3600 * 1000));
        if (!start || !end) return;
        const segStart = start > windowStart ? start : windowStart;
        const segEnd = end < windowEnd ? end : windowEnd;
        if (segStart >= segEnd) return;
        segments.push({ event: e, segStart, segEnd, isConflict: conflictEventIds.has(e.id) });
      });
      segments.sort((a, b) => a.segStart - b.segStart);

      const laneEnds = [];
      segments.forEach(seg => {
        let lane = laneEnds.findIndex(end => end <= seg.segStart);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(seg.segEnd);
        } else {
          laneEnds[lane] = seg.segEnd;
        }
        seg.lane = lane;
      });
      const laneCount = Math.max(1, laneEnds.length);
      segments.forEach(seg => {
        const topMin = (seg.segStart.getHours() * 60 + seg.segStart.getMinutes()) - MOBILE_WEEK_HOUR_START * 60;
        const durMin = (seg.segEnd - seg.segStart) / 60000;
        seg.top = (topMin / 60) * MOBILE_WEEK_ROW_HEIGHT;
        seg.height = Math.max(18, (durMin / 60) * MOBILE_WEEK_ROW_HEIGHT);
        seg.widthPct = 100 / laneCount;
        seg.leftPct = (seg.lane * 100) / laneCount;
      });

      return {
        dateObj,
        dateIso,
        dayNum: dateObj.getDate(),
        weekdayShort: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
        segments,
        hasEvents: segments.length > 0,
      };
    });
  }, [isMobile, viewMode, focusedDate, myEvents, conflictEventIds]);

  // Busy days get real width (min 96px); empty days shrink to a
  // neat 36px tap target so headers don't squish and event text remains legible.
  const mobileWeekGridTemplate = useMemo(() => {
    if (mobileWeekColumns.length === 0) return '';
    const cols = mobileWeekColumns.map(day => (day.hasEvents ? 'minmax(96px, 1fr)' : '36px'));
    return `44px ${cols.join(' ')}`;
  }, [mobileWeekColumns]);

  // Flatten the week grid into a single chronological list for mobile, and
  // collapse runs of 2+ consecutive days with nothing planned and nothing
  // available into one compact divider instead of one empty row per day.
  // A single isolated empty day is left as-is — collapsing just one day
  // doesn't save meaningful space and reads oddly.
  const mobileAgendaItems = useMemo(() => {
    if (!isMobile) return [];
    const allDays = festivalWeeks.flatMap(week => week.days);
    const isDayEmpty = (day) => {
      const plannedList = eventsByDate.plannedMap[day.dateIso] || [];
      const availCount = eventsByDate.availableCountMap[day.dateIso] || 0;
      return plannedList.length === 0 && availCount === 0;
    };

    const items = [];
    let i = 0;
    while (i < allDays.length) {
      if (!isDayEmpty(allDays[i])) {
        items.push({ type: 'day', day: allDays[i] });
        i += 1;
        continue;
      }
      let j = i;
      while (j < allDays.length && isDayEmpty(allDays[j])) j += 1;
      const runLength = j - i;
      if (runLength >= 2) {
        items.push({ type: 'gap', days: allDays.slice(i, j) });
      } else {
        items.push({ type: 'day', day: allDays[i] });
      }
      i = j;
    }

    let lastMonthKey = null;
    items.forEach(item => {
      const firstDate = item.type === 'day' ? item.day.dateObj : item.days[0].dateObj;
      const monthKey = `${firstDate.getFullYear()}-${firstDate.getMonth()}`;
      if (monthKey !== lastMonthKey) {
        item.monthHeader = firstDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
        lastMonthKey = monthKey;
      }
    });

    return items;
  }, [isMobile, festivalWeeks, eventsByDate]);

  // Compute scrollTime for the focused date (scrolls to earliest scheduled event)
  const scrollTimeForFocusedDate = useMemo(() => {
    const dayEvents = myEvents.filter(e => {
      const d = parseAPIDate(e.start_date);
      return d && toIsoDate(d) === focusedDate;
    });
    if (dayEvents.length === 0) return '07:30:00';

    let minMinutes = 24 * 60;
    dayEvents.forEach(e => {
      const d = parseAPIDate(e.start_date);
      if (d) {
        const mins = d.getHours() * 60 + d.getMinutes();
        if (mins < minMinutes) minMinutes = mins;
      }
    });
    const targetMins = Math.max(0, minMinutes - 30);
    const hrs = String(Math.floor(targetMins / 60)).padStart(2, '0');
    const mins = String(targetMins % 60).padStart(2, '0');
    return `${hrs}:${mins}:00`;
  }, [myEvents, focusedDate]);

  // Sync FullCalendar view & date when focusedDate or viewMode changes
  useEffect(() => {
    if (viewMode !== 'overview' && calendarRef.current) {
      const api = calendarRef.current.getApi();
      const fcViewType = getFcViewType(viewMode);
      if (api.view.type !== fcViewType) {
        api.changeView(fcViewType);
      }
      // listPlan is locked to a fixed visibleRange, so moving the focused
      // date shouldn't shrink it back down to a single week.
      if (fcViewType !== 'listPlan') {
        api.gotoDate(focusedDate);
      }
    }
  }, [focusedDate, viewMode]);

  // Initial scroll/focus on first week
  useEffect(() => {
    if (viewMode === 'overview' && firstWeekRef.current) {
      firstWeekRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [viewMode]);

  // Transform events for FullCalendar
  const fcEvents = useMemo(() => {
    const filtered = filterConflictsOnly 
      ? myEvents.filter(e => conflictEventIds.has(e.id))
      : myEvents;

    return filtered.map(event => toFullCalendarEvent(event, conflictEventIds.has(event.id)));
  }, [myEvents, conflictEventIds, filterConflictsOnly]);

  const focusedConflicts = useMemo(() => activeConflictPairs.filter(({ overlapStart, overlapEnd }) => {
    const dayStart = fromIsoDate(focusedDate);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return overlapStart < dayEnd && overlapEnd > dayStart;
  }), [activeConflictPairs, focusedDate]);

  const totalCost = useMemo(() => myEvents.reduce((acc, curr) => acc + (curr.price || 0), 0), [myEvents]);

  // Cell click handler: set focused date & open single-day timeline grid!
  const handleCellClick = (dateIso) => {
    setFocusedDate(dateIso);
    setViewMode('timeGridDay');
  };

  // Day Navigation Prev/Next
  const handlePrevDay = () => {
    const d = fromIsoDate(focusedDate);
    d.setDate(d.getDate() - 1);
    setFocusedDate(toIsoDate(d));
  };

  const handleNextDay = () => {
    const d = fromIsoDate(focusedDate);
    d.setDate(d.getDate() + 1);
    setFocusedDate(toIsoDate(d));
  };

  // Week Navigation Prev/Next (Week Timeline had no way to move between
  // weeks at all — shift the focused date by a full week so FullCalendar's
  // gotoDate lands on the next/previous week; the mobile compressed grid
  // reads focusedDate the same way).
  const handlePrevWeek = () => {
    const d = fromIsoDate(focusedDate);
    d.setDate(d.getDate() - 7);
    setFocusedDate(toIsoDate(d));
  };

  const handleNextWeek = () => {
    const d = fromIsoDate(focusedDate);
    d.setDate(d.getDate() + 7);
    setFocusedDate(toIsoDate(d));
  };

  // Toggle Conflict Filter Mode
  const handleToggleConflictFilter = () => {
    if (!filterConflictsOnly) {
      setFilterConflictsOnly(true);
      if (conflictDates.length > 0) {
        setConflictIndex(0);
        setFocusedDate(conflictDates[0]);
        setViewMode('timeGridDay');
      }
    } else {
      setFilterConflictsOnly(false);
      setViewMode('overview');
    }
  };

  const handlePrevConflict = () => {
    if (conflictIndex > 0) {
      const nextIdx = conflictIndex - 1;
      setConflictIndex(nextIdx);
      setFocusedDate(conflictDates[nextIdx]);
    }
  };

  const handleNextConflict = () => {
    if (conflictIndex < conflictDates.length - 1) {
      const nextIdx = conflictIndex + 1;
      setConflictIndex(nextIdx);
      setFocusedDate(conflictDates[nextIdx]);
    }
  };

  const focusedDateFormatted = useMemo(() => {
    const d = fromIsoDate(focusedDate);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }, [focusedDate]);

  const focusedWeekRangeFormatted = useMemo(() => {
    // Always the full Sun–Sat week (the mobile grid compresses empty
    // columns but still spans a full week). Mobile drops the year and
    // uses a tighter dash so the pill never wraps.
    const weekStart = getStartOfWeek(fromIsoDate(focusedDate));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    const startLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = sameMonth
      ? weekEnd.toLocaleDateString('en-US', { day: 'numeric' })
      : weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return isMobile ? `${startLabel}–${endLabel}` : `${startLabel} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [focusedDate, isMobile]);

  // Shared cell renderer used by both the desktop week grid and the mobile
  // flat agenda list, so the two layouts never drift out of sync.
  const renderDayCell = (day) => {
    const plannedList = eventsByDate.plannedMap[day.dateIso] || [];
    const availCount = eventsByDate.availableCountMap[day.dateIso] || 0;
    const hasConflict = conflictDateSet.has(day.dateIso);

    return (
      <div
        key={day.dateIso}
        className={`overview-day-cell ${day.isMainWeekend ? 'main-weekend-cell' : ''} ${hasConflict ? 'has-conflict' : ''}`}
        onClick={() => handleCellClick(day.dateIso)}
      >
        <div className="cell-top">
          <span className="cell-date-num mono-font">
            <span className="cell-weekday-mobile">{day.dateObj.toLocaleDateString('en-US', { weekday: 'short' })} </span>
            {day.dayNum}
          </span>
          {hasConflict ? (
            <span className="cell-conflict-badge mono-font" title="There is a schedule conflict on this date">1 clash</span>
          ) : day.isMainWeekend && (
            <span className="cell-fest-badge mono-font">★ MAIN FEST</span>
          )}
        </div>

        {/* Planned Event Chips */}
        <div className="cell-chips-list">
          {plannedList.map(event => (
            <div
              key={event.id}
              className="event-chip mono-font"
              style={{ borderLeftColor: getTypeColor(event.type) }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectEventDetail(event);
              }}
            >
              {event.name}
            </div>
          ))}
        </div>

        {/* Subtle Available Events Count */}
        {availCount > 0 && (
          <div className="cell-avail-hint mono-font">
            {hasConflict ? 'Tap to compare times' : `${availCount} available`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="plan-page animate-fade-in">
      {/* Plan Header Summary */}
      <div className="plan-summary-bar">
        <div className="plan-stats-group">
          <div className="stat-card">
            <span className="stat-num">{myEvents.length}</span>
            <span className="stat-label">Events Planned</span>
          </div>
          <div className="stat-card">
            <span className="stat-num">₹{totalCost}</span>
            <span className="stat-label">Total Cost</span>
          </div>
          {activeConflictPairs.length > 0 ? (
            <div className="stat-card warning">
              <span className="stat-num">{activeConflictPairs.length}</span>
              <span className="stat-label">Schedule Conflicts</span>
            </div>
          ) : (
            <div className="stat-card success">
              <span className="stat-num">0</span>
              <span className="stat-label">Conflicts</span>
            </div>
          )}
        </div>

        <div className="plan-actions-group">
          <button className="export-ics-btn" onClick={() => exportEventsToICS(myEvents)}>
            <Download size={16} /> Download Calendar (.ics)
          </button>
          <button className="copy-text-btn" onClick={handleCopyPlanAsText}>
            {copiedText ? <Check size={16} /> : <ClipboardList size={16} />} {copiedText ? 'Copied!' : 'Copy as Text'}
          </button>
          <button className="share-plan-btn" onClick={onSharePlan}>
            <Share2 size={16} /> Share Plan
          </button>
        </div>
      </div>

      {/* Conflict Banner */}
      {activeConflictPairs.length > 0 && (
        <div className="conflict-banner animate-slide-in">
          <div className="conflict-banner-text">
            <AlertTriangle size={20} className="warning-icon" />
            <div>
              <strong>{activeConflictPairs.length} Schedule Conflicts Detected</strong>
              <p>Overlapping events scheduled at the same time.</p>
            </div>
          </div>

          <div className="conflict-controls-group">
            {filterConflictsOnly && conflictDates.length > 1 && (
              <div className="conflict-nav-arrows mono-font">
                <button onClick={handlePrevConflict} disabled={conflictIndex === 0}><ChevronLeft size={16} /></button>
                <span>{conflictIndex + 1} of {conflictDates.length}</span>
                <button onClick={handleNextConflict} disabled={conflictIndex === conflictDates.length - 1}><ChevronRight size={16} /></button>
              </div>
            )}

            <button 
              className={`conflict-filter-toggle ${filterConflictsOnly ? 'active' : ''}`}
              onClick={handleToggleConflictFilter}
            >
              {filterConflictsOnly ? 'Show All Planned Events' : 'Show Conflicts Only'}
            </button>
            <button
              className="ignore-conflict-btn"
              onClick={() => onIgnoreConflict?.(activeConflictPairs[Math.min(conflictIndex, activeConflictPairs.length - 1)]?.key)}
            >
              Ignore this clash
            </button>
          </div>
        </div>
      )}

      {activeConflictPairs.length === 0 && ignoredConflictKeys.length > 0 && (
        <div className="ignored-conflict-note mono-font">
          {ignoredConflictKeys.length} ignored clash{ignoredConflictKeys.length === 1 ? '' : 'es'}
          <button onClick={onRestoreIgnoredConflicts}>Restore warnings</button>
        </div>
      )}

      {/* View Switcher Controls */}
      <div className="calendar-controls-bar">
        <div className="view-mode-tabs">
          <button 
            className={`view-mode-btn ${viewMode === 'overview' ? 'active' : ''}`}
            onClick={() => setViewMode('overview')}
          >
            <Calendar size={16} /> Festival Overview (Default)
          </button>
          <button 
            className={`view-mode-btn ${viewMode === 'timeGridDay' ? 'active' : ''}`}
            onClick={() => setViewMode('timeGridDay')}
          >
            <Clock size={16} /> Day Timeline
          </button>
          <button 
            className={`view-mode-btn ${viewMode === 'listWeek' ? 'active' : ''}`}
            onClick={() => setViewMode('listWeek')}
          >
            <List size={16} /> Agenda
          </button>
          <button 
            className={`view-mode-btn ${viewMode === 'timeGridWeek' ? 'active' : ''}`}
            onClick={() => setViewMode('timeGridWeek')}
          >
            <Clock size={16} /> Week Timeline
          </button>
        </div>

        {viewMode !== 'overview' && (
          <div className="timeline-header-right">
            {viewMode === 'timeGridDay' && (
              <div className="compact-date-nav mono-font">
                <button onClick={handlePrevDay} title="Previous Day"><ChevronLeft size={16} /></button>
                <span className="focused-date-text">{focusedDateFormatted}</span>
                <button onClick={handleNextDay} title="Next Day"><ChevronRight size={16} /></button>
              </div>
            )}

            {viewMode === 'timeGridWeek' && (
              <div className="compact-date-nav mono-font">
                <button onClick={handlePrevWeek} title="Previous Week"><ChevronLeft size={16} /></button>
                <span className="focused-date-text">{focusedWeekRangeFormatted}</span>
                <button onClick={handleNextWeek} title="Next Week"><ChevronRight size={16} /></button>
              </div>
            )}

            <button className="back-overview-btn mono-font" onClick={() => setViewMode('overview')}>
              <ArrowLeft size={14} /> {isMobile ? 'Overview' : 'Back to Festival Overview'}
            </button>
          </div>
        )}
      </div>

      {/* VIEW RENDERER */}
      {viewMode === 'overview' ? (
        <div className="festival-overview-scroll-container">
          {!isMobile && (
            <div className="day-name-headers mono-font">
              <span>SUN</span><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span>
            </div>
          )}

          {isMobile ? (
            <div className="mobile-agenda-list">
              {mobileAgendaItems.map((item, idx) => (
                <React.Fragment key={item.type === 'day' ? item.day.dateIso : `gap-${item.days[0].dateIso}`}>
                  {item.monthHeader && (
                    <div className="sticky-month-divider mono-font" ref={idx === 0 ? firstWeekRef : null}>
                      {item.monthHeader}
                    </div>
                  )}
                  {item.type === 'day' ? (
                    renderDayCell(item.day)
                  ) : (
                    <div className="agenda-gap-divider mono-font">
                      {item.days.length} quiet day{item.days.length === 1 ? '' : 's'} · {item.days[0].dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{item.days[item.days.length - 1].dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="weeks-grid-wrapper">
              {festivalWeeks.map((week, weekIdx) => (
                <div
                  key={week.weekId}
                  className="week-row-block"
                  ref={weekIdx === 0 ? firstWeekRef : null}
                >
                  {week.monthHeader && (
                    <div className="sticky-month-divider mono-font">
                      {week.monthHeader}
                    </div>
                  )}

                  <div className="week-days-grid">
                    {week.days.map((day) => renderDayCell(day))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : viewMode === 'timeGridWeek' && isMobile ? (
        /* Unified 2D sticky mobile Week Timeline: 7 equal 84px day columns,
           time axis pinned to left, day headers pinned to top. Perfect 2D sync. */
        <div className="mobile-week-scroll-container">
          <div className="mobile-week-table">
            {/* Top-Left Corner Cell (Sticky Top & Left) */}
            <div className="mobile-week-corner-cell" />

            {/* Day Headers (Sticky Top) */}
            {mobileWeekColumns.map(day => (
              <button
                key={day.dateIso}
                className={`mobile-week-day-header ${day.hasEvents ? 'has-events' : ''} ${day.dateIso === focusedDate ? 'is-focused' : ''} mono-font`}
                onClick={() => handleCellClick(day.dateIso)}
              >
                <span className="mobile-week-day-name">{day.weekdayShort}</span>
                <span className="mobile-week-day-num">{day.dayNum}</span>
              </button>
            ))}

            {/* Time Axis Column (Sticky Left) */}
            <div className="mobile-week-axis-col mono-font">
              {Array.from({ length: MOBILE_WEEK_HOUR_END - MOBILE_WEEK_HOUR_START }).map((_, i) => (
                <div key={i} className="mobile-week-hour-label" style={{ height: MOBILE_WEEK_ROW_HEIGHT }}>
                  {formatHourLabel(MOBILE_WEEK_HOUR_START + i)}
                </div>
              ))}
            </div>

            {/* 7 Equal Day Columns */}
            {mobileWeekColumns.map((day, colIdx) => (
              <div
                key={day.dateIso}
                className={`mobile-week-day-col ${day.hasEvents ? 'has-events' : 'is-empty'}`}
                style={{
                  gridColumn: colIdx + 2,
                  height: (MOBILE_WEEK_HOUR_END - MOBILE_WEEK_HOUR_START) * MOBILE_WEEK_ROW_HEIGHT
                }}
                onClick={() => handleCellClick(day.dateIso)}
              >
                {day.segments.map((seg, idx) => (
                  <div
                    key={`${seg.event.id}-${idx}`}
                    className={`mobile-week-event ${seg.isConflict ? 'is-conflict' : ''}`}
                    style={{
                      top: seg.top,
                      height: seg.height,
                      left: `${seg.leftPct}%`,
                      width: `${seg.widthPct}%`,
                      borderLeftColor: getTypeColor(seg.event.type),
                    }}
                    onClick={(evt) => {
                      evt.stopPropagation();
                      onSelectEventDetail(seg.event);
                    }}
                  >
                    {seg.isConflict && <span className="mobile-week-event-clash">Clash</span>}
                    <span className="mobile-week-event-title">{seg.event.name}</span>
                    {seg.height >= 36 && (
                      <span className="mobile-week-event-time mono-font">
                        {formatTimeOnly(seg.event.start_date)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* FullCalendar Engine for Day Timeline, Agenda & desktop Week Timeline */
        <div className="fullcalendar-wrapper">
          {viewMode === 'timeGridDay' && focusedConflicts.map(({ eventA, eventB, overlapStart, overlapEnd }, index) => (
            <div key={`${eventA.id}::${eventB.id}`} className="conflict-timeline-header mono-font">
              <AlertTriangle size={16} />
              <span>
                Clash: {eventA.name} × {eventB.name} · {overlapStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}–{overlapEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          ))}

          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, listPlugin, interactionPlugin]}
            initialView={getFcViewType(viewMode)}
            views={{
              listPlan: {
                type: 'list',
                visibleRange: agendaVisibleRange || undefined,
              },
            }}
            initialDate={focusedDate}
            scrollTime={scrollTimeForFocusedDate}
            headerToolbar={false}
            events={fcEvents}
            eventContent={(eventInfo) => {
              const { isMultiDay, isConflict } = eventInfo.event.extendedProps;
              return (
                <div className={`fc-custom-event-card ${isMultiDay ? 'is-multiday' : ''}`}>
                  <div className="fc-card-top">
                    {isConflict && <span className="fc-clash-badge mono-font">Clash</span>}
                    <span className="fc-card-title">{eventInfo.event.title}</span>
                  </div>
                  {eventInfo.timeText && (
                    <span className="fc-card-time mono-font">{eventInfo.timeText}</span>
                  )}
                </div>
              );
            }}
            eventClick={(info) => {
              const found = myEvents.find(e => String(e.id) === String(info.event.id));
              if (found) onSelectEventDetail(found);
            }}
            eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
            dayHeaderFormat={{ weekday: 'long', month: 'short', day: 'numeric' }}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            height="100%"
            eventOverlap={true}
            allDaySlot={false}
            editable={false}
          />
        </div>
      )}
    </div>
  );
}
