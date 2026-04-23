import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: "#2563EB" }}>
      <Tabs.Screen name="index" options={{ title: "Trang chủ" }} />
      <Tabs.Screen name="listings" options={{ title: "Bảng hàng" }} />
      <Tabs.Screen name="demands" options={{ title: "Nhu cầu" }} />
      <Tabs.Screen name="menu" options={{ title: "Menu" }} />
    </Tabs>
  );
}
