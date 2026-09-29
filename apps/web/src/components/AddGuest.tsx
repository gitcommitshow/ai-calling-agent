'use client';

/**
 * Type in a guest who is not on the CSV. The phone is checked against the
 * whole list first, and an existing number is left as it is.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { normalizeGuestPhone, splitCallingCode } from '../domain/phone';
import { Icon } from './Icon';

interface Props {
  eventId: string;
}

/** A pasted full number fills the country code and the national number. */
function pastedNumber(raw: string): { countryCode: string; national: string } | null {
  const digits = raw.replace(/\D/g, '');
  if (!raw.trim().startsWith('+') || digits.length < 8) return null;
  const split = splitCallingCode(digits);
  if (split) return { countryCode: `+${split.code}`, national: split.national };
  return { countryCode: `+${digits.slice(0, 3)}`, national: digits.slice(3) };
}

export function AddGuest({ eventId }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const code = countryCode.replace(/\D/g, '');
    const national = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (!code || !national) {
      setError('Enter a country code and a phone number.');
      return;
    }
    const normalized = normalizeGuestPhone(`+${code}${national}`);
    if (!normalized.phone) {
      setError(normalized.reason ?? 'Enter a phone number with a country code.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/guests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: normalized.phone }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not add the guest');

      setName('');
      setCountryCode('+91');
      setPhone('');
      router.refresh();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack mt" onSubmit={(formEvent) => void submit(formEvent)}>
      <div>
        <h3>Add a guest</h3>
        <p className="small muted">
          For someone who is not on the CSV. The country code starts at +91. Change it for a guest elsewhere. If this number is already on the list, they are not added again. Calls outside India are not available yet.
        </p>
      </div>
      <div className="grid">
        <div>
          <label htmlFor="manual-guest-name">Name</label>
          <input
            id="manual-guest-name"
            value={name}
            required
            maxLength={200}
            placeholder="Riya Sen"
            onChange={(change) => setName(change.target.value)}
          />
        </div>
        <div>
          <label htmlFor="manual-guest-phone">Phone</label>
          <div className="phone-field">
            <input
              id="manual-guest-cc"
              className="country-code"
              type="tel"
              inputMode="tel"
              aria-label="Country code"
              value={countryCode}
              maxLength={4}
              required
              onChange={(change) => {
                const digits = change.target.value.replace(/\D/g, '').slice(0, 3);
                setCountryCode(digits ? `+${digits}` : '+');
              }}
            />
            <input
              id="manual-guest-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              required
              maxLength={18}
              placeholder="98765 43210"
              aria-describedby="manual-guest-cc"
              onChange={(change) => {
                const pasted = pastedNumber(change.target.value);
                if (pasted) {
                  setCountryCode(pasted.countryCode);
                  setPhone(pasted.national);
                  return;
                }
                setPhone(change.target.value.replace(/\D/g, '').slice(0, 14));
              }}
            />
          </div>
        </div>
      </div>
      <div>
        <button type="submit" disabled={busy}>
          <Icon name="users" /> {busy ? 'Adding...' : 'Add guest'}
        </button>
      </div>
      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
    </form>
  );
}
