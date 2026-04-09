export function LabelBadge({ label }: { label: string | null }) {
  switch (label) {
    case "valid":
      return (
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
          valid
        </span>
      );
    case "invalid":
      return (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
          invalid
        </span>
      );
    case "ambiguous":
      return (
        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
          ambiguous
        </span>
      );
    default:
      return null;
  }
}
