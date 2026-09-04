import { id } from './lib/ids.mjs';

/**
 * The framework's six loop events. Fixed by VAFF so growth analysis is
 * comparable across every app the factory produces.
 *
 * The tracker throws on an unknown name. Extending the vocabulary must be a
 * deliberate act — a typo that silently creates a seventh event name is how a
 * funnel quietly stops adding up.
 */
export const LOOP_EVENTS = ['signup', 'core_action', 'share', 'share_view', 'referred_signup', 'revenue'];

export class EventError extends Error {}

export function createTracker(db, now = () => Date.now()) {
  const insert = db.prepare('INSERT INTO events (id, name, user_id, props, created_at) VALUES (?, ?, ?, ?, ?)');

  return function track(name, { userId = null, ...props } = {}) {
    if (!LOOP_EVENTS.includes(name)) {
      throw new EventError(`Unknown loop event '${name}'. Known: ${LOOP_EVENTS.join(', ')}`);
    }
    const eventId = id('evt');
    insert.run(eventId, name, userId, JSON.stringify(props), now());
    return eventId;
  };
}
