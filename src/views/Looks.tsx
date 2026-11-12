export function Looks(_: { onOpen: (id: string) => void }) {
  return <div className="view" />;
}
export function PickLook(_: { itemId: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  return null;
}
