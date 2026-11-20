/** Small building blocks shared by the screens. */
import type React from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { radius, space, useColors } from "./theme";

/** A scrolling page with a large title, under the system status bar. */
export function Screen({
  title,
  subtitle,
  action,
  children,
  onRefresh,
  refreshing,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const colors = useColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl onRefresh={onRefresh} refreshing={!!refreshing} />
        ) : undefined
      }
    >
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </ScrollView>
  );
}

export function Panel({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {title ? (
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: colors.foreground }]}>
            {title}
          </Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export type Tone = "neutral" | "jade" | "warn" | "danger";

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const colors = useColors();
  const palette = {
    neutral: [colors.muted, colors.mutedForeground],
    jade: [colors.secondary, colors.secondaryForeground],
    warn: [colors.warnBackground, colors.warn],
    danger: [colors.dangerBackground, colors.destructive],
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: palette[0] }]}>
      <Text style={[styles.chipText, { color: palette[1] }]}>{children}</Text>
    </View>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text style={[styles.empty, { color: colors.mutedForeground }]}>
      {children}
    </Text>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <Text style={[styles.error, { color: colors.destructive }]}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "accent" | "plain" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [background, foreground] = {
    primary: [colors.primary, colors.primaryForeground],
    accent: [colors.secondary, colors.secondaryForeground],
    plain: ["transparent", colors.primary],
    danger: [colors.dangerBackground, colors.destructive],
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        size === "sm" ? styles.buttonSm : styles.button,
        { backgroundColor: background, opacity: pressed || disabled ? 0.6 : 1 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text
          style={[
            size === "sm" ? styles.buttonTextSm : styles.buttonText,
            { color: foreground },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** A thin bar showing `done` of `total`. */
export function Meter({ done, total }: { done: number; total: number }) {
  const colors = useColors();
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <View style={[styles.meter, { backgroundColor: colors.muted }]}>
      <View
        style={{
          width: `${share * 100}%`,
          height: "100%",
          borderRadius: 999,
          backgroundColor: colors.primary,
        }}
      />
    </View>
  );
}

/** Height of the floating tab bar plus a margin. */
export const TAB_BAR_SPACE = 120;

export const styles = StyleSheet.create({
  // Leaves room for the floating tab bar, which content scrolls under.
  screen: { padding: space.lg, paddingBottom: TAB_BAR_SPACE, gap: space.lg },
  titleRow: { flexDirection: "row", alignItems: "flex-end", gap: space.md },
  title: { fontSize: 32, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { fontSize: 15, marginTop: 2 },
  panel: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.sm,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xs,
  },
  panelTitle: { fontSize: 17, fontWeight: "600" },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  chipText: { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  empty: { fontSize: 14, paddingVertical: space.sm },
  error: { fontSize: 14 },
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSm: {
    minHeight: 34,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  buttonTextSm: { fontSize: 14, fontWeight: "600" },
  meter: { height: 8, borderRadius: 999, overflow: "hidden" },
});

export function TextField({
  label,
  style,
  ...props
}: React.ComponentProps<typeof TextInput> & { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        style={[
          fieldStyles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

/** A row of pill buttons choosing one value. */
export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[
              fieldStyles.segment,
              selected
                ? {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  }
                : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: selected ? "600" : "400",
                color: selected
                  ? colors.primaryForeground
                  : colors.mutedForeground,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A square checkbox. */
export function Check({ checked }: { checked: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        fieldStyles.check,
        {
          borderColor: colors.primary,
          backgroundColor: checked ? colors.primary : "transparent",
        },
      ]}
    >
      {checked ? (
        <Text style={{ color: colors.primaryForeground, fontSize: 13 }}>✓</Text>
      ) : null}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  segment: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
