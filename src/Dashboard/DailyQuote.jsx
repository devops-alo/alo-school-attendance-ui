import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { FiLock, FiStar } from "react-icons/fi";
import { getDailyQuote, pickDailyQuote } from "../api/serviceapi";
import styles from "./DailyQuote.module.css";

const FLIP_MS = 700;
const CLOSE_MS = 200;

// Days are counted in India time; a new day starts at IST midnight
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const istDay = (time) => Math.floor((time + IST_OFFSET_MS) / DAY_MS);
const msUntilIstMidnight = () =>
  DAY_MS - ((Date.now() + IST_OFFSET_MS) % DAY_MS);

const REVEAL_TITLE = "Today's power-up ⚡";
const REVEAL_ACTION = "Noted, let's go →";

const errorMessage = (err, fallback) => {
  const message = err?.response?.data?.message;
  return typeof message === "string" && message ? message : fallback;
};

// Compact version shown in the hero once the day's quote is known
const QuoteView = ({ quote }) => (
  <figure className={styles.quote}>
    <blockquote>“{quote.text}”</blockquote>
    {quote.author && <figcaption>— {quote.author}</figcaption>}
  </figure>
);

const Deck = ({ count, pendingCard, flippedCard, onPick }) => {
  const busy = pendingCard !== null || flippedCard !== null;
  // Fan position (-1 at the left end .. 1 at the right) and deal delay are
  // worked out here: CRA's CSS minifier can't parse max()/min() inside calc()
  const mid = (count - 1) / 2;
  const half = Math.max(1, mid);
  const dealStepMs = Math.min(35, 700 / count);

  return (
    <div
      className={styles.deck}
      style={{ "--count": count }}
      role="group"
      aria-label="Quote cards"
    >
      {Array.from({ length: count }, (_, i) => {
        const cardNo = i + 1;
        const isFlipped = flippedCard === cardNo;
        const isPending = pendingCard === cardNo && !isFlipped;

        return (
          <button
            key={cardNo}
            type="button"
            className={`${styles.card} ${isPending ? styles.pending : ""} ${
              isFlipped ? styles.flipped : ""
            }`}
            style={{
              "--pos": (i - mid) / half,
              "--deal-delay": `${Math.round(i * dealStepMs)}ms`,
            }}
            onClick={() => onPick(cardNo)}
            disabled={busy}
            aria-label={`Card ${cardNo} of ${count}`}
          >
            <span className={styles.inner}>
              <span className={styles.back} aria-hidden="true">
                ✦
              </span>
              <span className={styles.front} aria-hidden="true">
                {cardNo}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Quote of the day, shown in the dashboard hero in place of the subtitle.
 * Before check-in it says the quote is locked; after check-in a picker of
 * face-down cards pops up (it only closes once a card is picked), and the
 * picked quote then stays in the hero for the rest of the day.
 *
 * fallback:   the normal subtitle, shown while loading, if the quote API
 *             fails, or when there is nothing to show today.
 * refreshKey: bump it right after a successful check-in to unlock the cards.
 * hidden:     nothing to pick today (e.g. on leave).
 */
const DailyQuote = ({ fallback, refreshKey = 0, hidden = false }) => {
  const [today, setToday] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pendingCard, setPendingCard] = useState(null);
  const [flippedCard, setFlippedCard] = useState(null);
  const [revealed, setRevealed] = useState(null); // { cardNo, quote } shown inside the modal
  const [pickFailed, setPickFailed] = useState(false); // shows a way out, e.g. "No quotes available"
  const inFlight = useRef(false);
  const latestRequest = useRef(0);
  const autoOpenedDay = useRef(null);
  const lastRefreshKey = useRef(refreshKey);
  const timers = useRef([]);
  const dialogRef = useRef(null);

  const later = (fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  };

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Only the latest reply is used, so a slow earlier one can't overwrite it.
  // A failed load keeps whatever was shown (the normal subtitle at first).
  const fetchToday = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const response = await getDailyQuote();
      if (request !== latestRequest.current) return;
      setToday(response?.data?.data || null);
      setFetchedAt(Date.now());
    } catch (err) {
      if (request !== latestRequest.current) return;
      console.error("Error fetching today's quote:", err?.message);
    }
  }, []);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  // Just checked in: unlock the cards straight away (cardCount is already known),
  // then confirm with the server
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    setToday((prev) => (prev ? { ...prev, checkedIn: true } : prev));
    fetchToday();
  }, [refreshKey, fetchToday]);

  const canPick = !hidden && !!today?.checkedIn && !today?.picked;

  // Pop the picker once a day as soon as it's available (page load or right after check-in)
  useEffect(() => {
    const day = istDay(Date.now());
    if (canPick && autoOpenedDay.current !== day) {
      autoOpenedDay.current = day;
      setModalOpen(true);
    }
  }, [canPick]);

  // New IST day: refetch at midnight, and on focus if the page slept through it
  useEffect(() => {
    const refreshIfNewDay = () => {
      if (fetchedAt && istDay(Date.now()) !== istDay(fetchedAt)) fetchToday();
    };
    const midnight = setTimeout(fetchToday, msUntilIstMidnight() + 2000);

    window.addEventListener("focus", refreshIfNewDay);
    document.addEventListener("visibilitychange", refreshIfNewDay);
    return () => {
      clearTimeout(midnight);
      window.removeEventListener("focus", refreshIfNewDay);
      document.removeEventListener("visibilitychange", refreshIfNewDay);
    };
  }, [fetchedAt, fetchToday]);

  // While the picker is open the page behind it doesn't scroll
  useEffect(() => {
    if (!modalOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [modalOpen]);

  const handlePick = async (cardNo) => {
    // The ref blocks a second tap that lands before React re-renders
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingCard(cardNo);

    const failed = (message) => {
      toast.error(message, { autoClose: 2500 });
      inFlight.current = false;
      setPendingCard(null);
      setPickFailed(true);
    };

    try {
      const response = await pickDailyQuote(cardNo);
      const result = response?.data;
      if (result?.status === false || !result?.data?.quote) {
        failed(result?.message || "Couldn't pick a card. Please try again.");
        return;
      }

      // If it was already picked elsewhere, flip the card picked first
      const { cardNo: pickedCard, quote } = result.data;
      setFlippedCard(pickedCard);
      later(() => setRevealed({ cardNo: pickedCard, quote }), FLIP_MS + 250);
    } catch (err) {
      failed(errorMessage(err, "Couldn't pick a card. Please try again."));
    }
  };

  // Fade the modal out, then move the revealed quote into the hero
  const closeModal = () => {
    if (closing) return;
    setClosing(true);
    later(() => {
      if (revealed) {
        setToday((prev) => ({ ...prev, picked: true, ...revealed }));
      }
      inFlight.current = false;
      setPendingCard(null);
      setFlippedCard(null);
      setRevealed(null);
      setPickFailed(false);
      setClosing(false);
      setModalOpen(false);
    }, CLOSE_MS);
  };

  const count = Math.min(Math.max(Number(today?.cardCount) || 12, 2), 50);

  // The normal subtitle covers loading, a failed load, and days with nothing to pick
  const content =
    !today || (hidden && !today.picked) ? (
      <span>{fallback}</span>
    ) : today.picked ? (
      today.quote ? (
        <QuoteView quote={today.quote} />
      ) : (
        <span>{fallback}</span>
      )
    ) : !today.checkedIn ? (
      <span className={styles.locked}>
        <FiLock aria-hidden="true" /> Check in to unlock today&apos;s quote
      </span>
    ) : (
      <button
        type="button"
        className={styles.revealButton}
        onClick={() => setModalOpen(true)}
      >
        <FiStar aria-hidden="true" /> Reveal today&apos;s quote
      </button>
    );

  const modal = modalOpen
    ? createPortal(
        <div
          className={`${styles.overlay} ${closing ? styles.overlayClosing : ""}`}
        >
          <div
            ref={dialogRef}
            className={`${styles.modal} ${closing ? styles.modalClosing : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-quote-title"
            tabIndex={-1}
          >
            <div className={styles.picker}>
              {revealed ? (
                <div className={styles.reveal}>
                  <h2 id="daily-quote-title" className={styles.title}>
                    {REVEAL_TITLE}
                  </h2>
                  <figure className={styles.quoteCard}>
                    <div className={styles.cardHead}>
                      <span className={styles.shine} aria-hidden="true" />
                      <span className={styles.headLabel}>Quote of the day</span>
                      <span className={styles.cardBadge}>
                        ✦ Card {revealed.cardNo}
                      </span>
                    </div>
                    <span className={styles.quoteMark} aria-hidden="true">
                      “
                    </span>
                    <div className={styles.cardBody}>
                      <blockquote>{revealed.quote.text}</blockquote>
                      {revealed.quote.author && (
                        <figcaption>
                          <span className={styles.authorDot} aria-hidden="true">
                            {revealed.quote.author.trim().charAt(0)}
                          </span>
                          <span className={styles.authorName}>
                            {revealed.quote.author}
                            <small>Author</small>
                          </span>
                        </figcaption>
                      )}
                    </div>
                  </figure>
                  <button
                    type="button"
                    className={styles.revealAction}
                    onClick={closeModal}
                    autoFocus
                  >
                    {REVEAL_ACTION}
                  </button>
                </div>
              ) : (
                <>
                  <span className={styles.icon} aria-hidden="true">
                    <FiStar />
                  </span>
                  <h2 id="daily-quote-title" className={styles.title}>
                    Pick a card for today
                  </h2>
                  <p className={styles.description}>
                    Tap any card to reveal your quote of the day.
                  </p>
                  <Deck
                    count={count}
                    pendingCard={pendingCard}
                    flippedCard={flippedCard}
                    onPick={handlePick}
                  />
                  <p className={styles.deckHint}>
                    {pendingCard !== null
                      ? "Turning your card…"
                      : `${count} cards · one pick per day`}
                  </p>
                  {pickFailed && pendingCard === null && (
                    <button
                      type="button"
                      className={styles.closeLink}
                      onClick={closeModal}
                    >
                      Close
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {content}
      {modal}
    </>
  );
};

export default DailyQuote;
