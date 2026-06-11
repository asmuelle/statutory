import type { Delivery, PracticeProfile } from '@statutory/core';
import type { EmailAlert } from '@statutory/pipeline';

interface FanOutProps {
  readonly deliveries: readonly Delivery[];
  readonly profiles: readonly PracticeProfile[];
  readonly emailAlert: EmailAlert;
}

const profileName = (profiles: readonly PracticeProfile[], id: string): string =>
  profiles.find((p) => p.id === id)?.name ?? id;

/**
 * Fan-out: the one authored delta delivered to exactly the matched profiles
 * (invariant 5), plus the rendered email alert for the demo CA profile.
 */
export function FanOut({ deliveries, profiles, emailAlert }: FanOutProps) {
  return (
    <section className="slice-section" aria-labelledby="fanout-heading">
      <h2 id="fanout-heading">Fan-out — one delta, matched profiles only</h2>
      <table className="delivery-table">
        <thead>
          <tr>
            <th scope="col">Profile</th>
            <th scope="col">Channel</th>
            <th scope="col">Sent</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((delivery) => (
            <tr key={delivery.id}>
              <td>{profileName(profiles, delivery.profileId)}</td>
              <td>
                <code>{delivery.channel}</code>
              </td>
              <td>
                <code>{delivery.sentAt}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <figure className="email-preview">
        <figcaption className="rulebook-citation">
          Email alert preview — {emailAlert.subject}
        </figcaption>
        <pre>{emailAlert.body}</pre>
      </figure>
    </section>
  );
}
