/** An email address that breaks only after its "@", never mid-word or at a dash. */
export function EmailAddress({ email }: { email: string }) {
  const at = email.lastIndexOf('@');
  if (at < 0) return <span className="whitespace-nowrap">{email}</span>;
  return (
    <span>
      <span className="whitespace-nowrap">{email.slice(0, at + 1)}</span>
      <wbr />
      <span className="whitespace-nowrap">{email.slice(at + 1)}</span>
    </span>
  );
}
