import type { ReactNode } from 'react'
import styles from '@/app/landing.module.css'
import { HeroEnhancement } from './HeroEnhancement'

function Preview({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure className={styles.preview}>
      <figcaption className={styles.previewHeader}>
        <span>{title}</span>
        <span className={styles.example}>Illustrative example</span>
      </figcaption>
      {children}
    </figure>
  )
}

export function HeroWorkflow() {
  return (
    <figure
      className={styles.heroFigure}
      aria-label="A teaching session connects to reviewed attendance and eligible certificates, with feedback collected separately."
    >
      <div className={styles.heroDiagram}>
        <HeroEnhancement />
        <svg
          className={styles.connections}
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <path d="M50 38 V43 H25 V46 M50 43 H78 V45 M25 66 V83 H30" />
        </svg>
        <div className={`${styles.heroPanel} ${styles.sessionPanel}`}>
          <span className={styles.panelLabel}>THE TEACHING WEEK</span>
          <div className={styles.sessionHeading}>
            <span className={styles.calendarIcon} aria-hidden="true">
              12
            </span>
            <div>
              <strong>Acute medicine</strong>
              <span>Monday · 13:00–14:00</span>
            </div>
          </div>
          <div className={styles.panelFooter}>
            <span>Clinical teaching</span>
            <span className={styles.status}>Scheduled</span>
          </div>
        </div>
        <div className={`${styles.heroPanel} ${styles.attendancePanel}`}>
          <span className={styles.panelLabel}>ATTENDANCE</span>
          <strong>Reviewed. Finalized.</strong>
          <div className={styles.miniRoster} aria-hidden="true">
            <span>✓</span>
            <i />
            <span>✓</span>
            <i />
          </div>
        </div>
        <div className={`${styles.heroPanel} ${styles.feedbackPanel}`}>
          <span className={styles.panelLabel}>FEEDBACK</span>
          <strong>A clearer picture.</strong>
          <div className={styles.miniBars} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className={`${styles.heroPanel} ${styles.certificatePanel}`}>
          <span className={styles.certificateMark} aria-hidden="true">
            ✳
          </span>
          <div>
            <span className={styles.panelLabel}>ELIGIBLE CERTIFICATES</span>
            <strong>Teaching that counts.</strong>
            <span className={styles.certificateDetail}>
              A verifiable record
            </span>
          </div>
        </div>
      </div>
      <figcaption className={styles.heroCaption}>
        <span className={styles.captionDot} />
        One connected teaching workflow<span>Illustrative example</span>
      </figcaption>
    </figure>
  )
}

export function SchedulePreview() {
  return (
    <Preview title="Programme / Teaching week">
      <div className={styles.scheduleHeading}>
        <strong>April 12–16</strong>
        <span className={styles.status}>3 sessions planned</span>
      </div>
      <div className={styles.scheduleGrid}>
        {['MON 12', 'TUE 13', 'WED 14'].map((day) => (
          <div className={styles.day} key={day}>
            {day}
          </div>
        ))}
        <div className={styles.calendarCell}>
          <div className={styles.calendarEvent}>
            <span>13:00 · 60 MIN</span>
            <strong>Acute medicine</strong>
            <span>Teacher confirmed</span>
          </div>
        </div>
        <div className={styles.calendarCell}>
          <div className={`${styles.calendarEvent} ${styles.openSlot}`}>
            <span>12:30 · 30 MIN</span>
            <strong>Open teaching slot</strong>
            <span>Available to claim ↗</span>
          </div>
        </div>
        <div className={styles.calendarCell}>
          <div className={styles.calendarEvent}>
            <span>14:00 · 60 MIN</span>
            <strong>Clinical skills</strong>
            <span>Teacher confirmed</span>
          </div>
        </div>
        <div className={styles.calendarCell} />
        <div className={styles.calendarCell}>
          <div className={styles.calendarEvent}>
            <span>15:00 · 45 MIN</span>
            <strong>Case discussion</strong>
            <span>Teacher confirmed</span>
          </div>
        </div>
        <div className={styles.calendarCell} />
      </div>
      <div className={styles.previewFooter}>
        <span className={styles.captionDot} />A shared view of the week ahead
      </div>
    </Preview>
  )
}

export function AttendancePreview() {
  return (
    <Preview title="Acute medicine / Attendance">
      <div className={styles.scheduleHeading}>
        <div>
          <strong>Session roster</strong>
          <p className={styles.previewSubheading}>
            Evidence reviewed by the organiser
          </p>
        </div>
        <span className={styles.status}>Finalized · v1</span>
      </div>
      <div
        className={styles.roster}
        role="table"
        aria-label="Illustrative attendance roster"
      >
        <div className={styles.rosterHeader} role="row">
          <span role="columnheader">Trainee</span>
          <span role="columnheader">Evidence</span>
          <span role="columnheader">Result</span>
        </div>
        {[
          ['Trainee A', 'Moderator confirmation', 'Present'],
          ['Trainee B', 'Teacher confirmation', 'Present'],
          ['Trainee C', 'Secure session code', 'Late'],
        ].map(([name, evidence, result]) => (
          <div className={styles.rosterRow} key={name} role="row">
            <strong role="rowheader">{name}</strong>
            <span role="cell">{evidence}</span>
            <span className={styles.rosterResult} role="cell">
              {result}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.previewFooter}>
        <span aria-hidden="true">↳</span>Certificates use the finalized
        attendance revision.
      </div>
    </Preview>
  )
}

export function EvidencePreview() {
  return (
    <Preview title="Portfolio / Teaching evidence">
      <div className={styles.evidenceBody}>
        <div className={styles.certificate}>
          <div className={styles.certificateTop}>
            <span>PETRIOS</span>
            <span aria-hidden="true">✳</span>
          </div>
          <span className={styles.panelLabel}>CERTIFICATE OF ATTENDANCE</span>
          <strong>Acute medicine</strong>
          <p>Clinical teaching · 1 hour</p>
          <div className={styles.certificateRule} />
          <span className={styles.verified}>✓ Verifiable teaching record</span>
        </div>
        <div className={styles.evidenceItems}>
          <div>
            <span aria-hidden="true">↗</span>
            <div>
              <strong>Feedback report</strong>
              <span>Reviewed and released</span>
            </div>
          </div>
          <div>
            <span aria-hidden="true">≡</span>
            <div>
              <strong>Personal reflection</strong>
              <span>Learning put into words</span>
            </div>
          </div>
          <div>
            <span aria-hidden="true">↗</span>
            <div>
              <strong>Portfolio pack</strong>
              <span>Evidence brought together</span>
            </div>
          </div>
        </div>
      </div>
    </Preview>
  )
}

export function NewsletterPreview() {
  return (
    <Preview title="Department newsletter">
      <div className={styles.newsletter}>
        <div className={styles.newsletterMeta}>
          <span>WEEKLY ROUNDUP</span>
          <span className={styles.status}>Awaiting approval</span>
        </div>
        <h3>
          This week in
          <br />
          clinical teaching.
        </h3>
        <p>
          A look back at acute medicine, clinical skills, and the conversations
          to carry into next week.
        </p>
        <div className={styles.newsletterRule} />
        <div className={styles.newsletterSummary}>
          <span>01</span>
          <div>
            <strong>From the teaching room</strong>
            <p>
              Key themes from this week’s sessions and shared teaching
              materials.
            </p>
          </div>
        </div>
        <div className={styles.draftNote}>
          Draft for organiser review · Not sent
        </div>
      </div>
    </Preview>
  )
}
