/**
 * Temporary placeholder used by the scaffold so the router compiles before
 * screen agents add their real screens. Each screen agent OVERWRITES the file
 * src/screens/<Name>/<Name>.tsx with a real default-exported component.
 */
export function ScreenPlaceholder({ name }: { name: string }) {
  return (
    <div className="screen">
      <h1 className="screen__title">{name}</h1>
      <div className="card">
        <p>Coming soon.</p>
      </div>
    </div>
  );
}
