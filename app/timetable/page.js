"use client";

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "../api-base-url";
import { getLoggedInUserEmail } from "../login-session";
import styles from "./timetable.module.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function displayTime(value) {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function SlotContent({ period, slot }) {
  if (!period.is_teaching) return <span className={styles.breakLabel}>{period.period_label}</span>;
  if (!slot) return <span className={styles.freeLabel}>Free period</span>;
  return <><strong className={styles.subject}>{slot.subject_name || "Subject not specified"}</strong>
    <span className={styles.teacher}>{slot.teacher_name || "Teacher details unavailable"}</span></>;
}

export default function TimetablePage() {
  const [data, setData] = useState(null);
  const [year, setYear] = useState("");
  const [schedule, setSchedule] = useState("full");
  const [selectedDay, setSelectedDay] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const today = new Date().getDay();
    setSelectedDay(today >= 1 && today <= 6 ? today : 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTimetable() {
      setLoading(true);
      setError("");
      try {
        const email = await getLoggedInUserEmail();
        if (controller.signal.aborted) return;
        if (!email) throw new Error("Your login session is unavailable. Please sign in again.");
        const params = new URLSearchParams({ email, schedule_type: schedule });
        if (year) params.set("academic_year", year);
        const response = await fetch(`${getApiBaseUrl()}/timetable?${params}`, {
          credentials: "include", cache: "no-store", signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error("Your session could not be verified. Please sign in again, then retry.");
          }
          throw new Error(typeof payload.detail === "string" ? payload.detail : "Unable to load your timetable. Please try again.");
        }
        if (!controller.signal.aborted) setData(payload);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setData(null);
          setError(failure.message || "Unable to load your timetable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    loadTimetable();
    return () => controller.abort();
  }, [year, schedule, revision]);

  const periods = data?.periods || [];
  const days = data?.days || [];
  const activeDay = days.find((day) => day.day_of_week === selectedDay);
  const selectedYear = year || data?.academic_year || "";
  const years = data?.academic_years || [];
  const scheduleTypes = [...new Set([schedule, ...(data?.schedule_types || [])])];
  const classLabel = data?.student?.class_name || (data?.student?.class_id ? `Class ${data.student.class_id}` : "");
  const scheduleLabel = (value) => value === "full" ? "Full day" : value === "half" ? "Half day" : value;

  return (
    <section className={styles.page} aria-labelledby="timetable-title">
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>YOUR SCHOOL WEEK</p><h2 id="timetable-title">My Timetable</h2>
          <p className={styles.description}>Your subjects, teachers and breaks, all in one place.</p></div>
        {classLabel && <span className={styles.classBadge}>{classLabel} · Section {data.section}</span>}
      </header>

      <div className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.filters}>
            <label>Academic year<select value={selectedYear} disabled={loading || !years.length}
              onChange={(event) => setYear(event.target.value)}>
              {!years.length && <option value="">Not available</option>}
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Schedule<select value={schedule} disabled={loading} onChange={(event) => setSchedule(event.target.value)}>
              {scheduleTypes.map((value) => <option key={value} value={value}>{scheduleLabel(value)}</option>)}
            </select></label>
          </div>
          <button className={styles.refresh} type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
            <span aria-hidden="true">↻</span> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {loading ? <div className={styles.state} role="status"><span className={styles.spinner} />Loading your timetable…</div>
          : error ? <div className={`${styles.state} ${styles.error}`} role="alert"><h3>Timetable unavailable</h3><p>{error}</p>
            <button className={styles.refresh} type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div>
            : !periods.length ? <div className={styles.state}><h3>No schedule published yet</h3>
              <p>Your school has not published period timings for this schedule yet.</p></div>
              : <>
                {!data.has_slots && <p className={styles.notice} role="status">Period timings are available. Your class timetable has not been published yet.</p>}
                <div className={styles.legend}><span><i className={styles.lessonDot} />Lesson</span><span><i className={styles.breakDot} />Assembly / break</span>
                  <span><i className={styles.freeDot} />Free period</span></div>
                <p className={styles.scrollHint}>Scroll across to see the full school day.</p>
                <div className={styles.weekView} role="region" aria-label="Weekly timetable, scroll horizontally" tabIndex={0}>
                  <table className={styles.grid}>
                    <caption className={styles.srOnly}>{classLabel}, section {data.section}, {selectedYear}, {scheduleLabel(schedule)}</caption>
                    <thead><tr><th scope="col" className={styles.dayHeader}>Day</th>{periods.map((period) =>
                      <th key={period.period_id} scope="col" className={!period.is_teaching ? styles.breakHeader : ""}>
                        <span>{period.period_label}</span><small>{displayTime(period.start_time)}<br />{displayTime(period.end_time)}</small></th>)}</tr></thead>
                    <tbody>{days.map((day) => <tr key={day.day_of_week}>
                      <th scope="row" className={styles.dayHeader}>{day.day_name}</th>
                      {periods.map((period) => {
                        const slot = day.slots.find((entry) => entry.period_no === period.period_no);
                        return <td key={period.period_id} className={!period.is_teaching ? styles.breakCell : slot ? styles.lessonCell : styles.freeCell}>
                          <SlotContent period={period} slot={slot} /></td>;
                      })}
                    </tr>)}</tbody>
                  </table>
                </div>
                <div className={styles.mobileView}>
                  <div className={styles.dayTabs} role="group" aria-label="Choose timetable day">{DAYS.map((day, index) =>
                    <button type="button" key={day} aria-pressed={selectedDay === index + 1} onClick={() => setSelectedDay(index + 1)}>{day.slice(0, 3)}</button>)}</div>
                  <h3 className={styles.mobileDay}>{activeDay?.day_name}</h3>
                  <ol className={styles.dayList}>{periods.map((period) => {
                    const slot = activeDay?.slots.find((entry) => entry.period_no === period.period_no);
                    return <li key={period.period_id} className={!period.is_teaching ? styles.mobileBreak : ""}>
                      <div className={styles.time}><strong>{displayTime(period.start_time)}</strong><span>{displayTime(period.end_time)}</span></div>
                      <div className={styles.mobileSlot}>{period.is_teaching && <span className={styles.periodLabel}>{period.period_label}</span>}
                        <SlotContent period={period} slot={slot} /></div></li>;
                  })}</ol>
                </div>
              </>}
      </div>
      <p className={styles.footer}>Timetable updates are managed by your school. Use Refresh to see the latest schedule.</p>
    </section>
  );
}
