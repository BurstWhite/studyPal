/**
 * Renders the Markdown that assistant replies use: paragraphs, headings,
 * lists, block quotes, code blocks and tables (as plain rows), with bold,
 * italic, inline code and links inside. Unknown syntax shows as text.
 */
import { Fragment, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";
import { parseBlocks } from "./markdownBlocks";
import { radius, space, useColors, type Colors } from "./theme";

/** Inline spans: `code`, **bold**, *italic* / _italic_, [text](url). */
function inline(text: string, colors: Colors): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (match[1]) {
      out.push(
        <Text
          key={key++}
          style={{
            fontFamily: "Menlo",
            fontSize: 13,
            backgroundColor: colors.muted,
          }}
        >
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (match[2]) {
      out.push(
        <Text key={key++} style={{ fontWeight: "700" }}>
          {inline(token.slice(2, -2), colors)}
        </Text>,
      );
    } else if (match[3]) {
      out.push(
        <Text key={key++} style={{ fontStyle: "italic" }}>
          {inline(token.slice(1, -1), colors)}
        </Text>,
      );
    } else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push(
        <Text
          key={key++}
          style={{ color: colors.primary, textDecorationLine: "underline" }}
          onPress={() => void Linking.openURL(url!)}
        >
          {label}
        </Text>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ children }: { children: string }) {
  const colors = useColors();
  const base = { color: colors.foreground, fontSize: 15, lineHeight: 22 };
  return (
    <View style={{ gap: space.sm }}>
      {parseBlocks(children).map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={index}
                style={[
                  base,
                  { fontWeight: "700", fontSize: block.level <= 2 ? 17 : 15 },
                ]}
              >
                {inline(block.text, colors)}
              </Text>
            );
          case "paragraph":
            return (
              <Text key={index} style={base}>
                {inline(block.text, colors)}
              </Text>
            );
          case "quote":
            return (
              <View
                key={index}
                style={{
                  borderLeftWidth: 2,
                  borderColor: colors.border,
                  paddingLeft: space.md,
                }}
              >
                <Text style={[base, { color: colors.mutedForeground }]}>
                  {inline(block.text, colors)}
                </Text>
              </View>
            );
          case "code":
            return (
              <View
                key={index}
                style={{
                  backgroundColor: colors.muted,
                  borderRadius: radius.sm,
                  padding: space.md,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Menlo",
                    fontSize: 13,
                    color: colors.foreground,
                  }}
                >
                  {block.text}
                </Text>
              </View>
            );
          case "list":
            return (
              <View key={index} style={{ gap: 4 }}>
                {block.items.map((item, itemIndex) => (
                  <View
                    key={itemIndex}
                    style={{ flexDirection: "row", gap: 6 }}
                  >
                    <Text
                      style={[
                        base,
                        { minWidth: 16, color: colors.mutedForeground },
                      ]}
                    >
                      {block.ordered ? `${itemIndex + 1}.` : "•"}
                    </Text>
                    <Text style={[base, { flex: 1 }]}>
                      {inline(item, colors)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case "table":
            return (
              <View
                key={index}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                }}
              >
                {block.rows.map((row, rowIndex) => (
                  <View
                    key={rowIndex}
                    style={{
                      flexDirection: "row",
                      borderTopWidth: rowIndex === 0 ? 0 : 1,
                      borderColor: colors.border,
                    }}
                  >
                    {row.map((cell, cellIndex) => (
                      <Fragment key={cellIndex}>
                        <Text
                          style={[
                            base,
                            {
                              flex: 1,
                              fontSize: 13,
                              padding: 6,
                              fontWeight: rowIndex === 0 ? "600" : "400",
                            },
                          ]}
                        >
                          {inline(cell, colors)}
                        </Text>
                      </Fragment>
                    ))}
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}
