import { Icon } from "@devdigest/ui";
import { s } from "../../styles";

/** IN SCOPE / OUT OF SCOPE bullet list. Item order is never reordered (it's
 *  static per fetch), so keys are safely derived from item text + index. */
export function ScopeList({
  heading,
  items,
  icon,
  iconColor,
}: {
  heading: string;
  items: string[];
  icon: "Check" | "X";
  iconColor: string;
}) {
  const I = Icon[icon];
  return (
    <div style={s.scopeColumn}>
      <div style={s.scopeHeading}>{heading}</div>
      <ul style={s.scopeList}>
        {items.map((item, i) => (
          <li key={`${item}-${i}`} style={s.scopeListItem}>
            <I size={14} style={{ ...s.scopeListItemIcon, color: iconColor }} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
