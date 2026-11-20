import { useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useColors } from "@/ui/theme";

export default function TabsLayout() {
  const colors = useColors();
  // An open conversation needs the bottom of the screen for its message box.
  const segments = useSegments() as string[];
  const inConversation = segments.includes("chat") && segments.includes("[id]");
  return (
    <NativeTabs tintColor={colors.primary} hidden={inConversation}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>今天</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "sun.max", selected: "sun.max.fill" }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>日程</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="deadlines">
        <NativeTabs.Trigger.Label>作业</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "checklist", selected: "checklist.checked" }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>对话</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: "bubble.left.and.bubble.right",
            selected: "bubble.left.and.bubble.right.fill",
          }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <NativeTabs.Trigger.Label>我的</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: "person.crop.circle",
            selected: "person.crop.circle.fill",
          }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
