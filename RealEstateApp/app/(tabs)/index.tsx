import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DashboardScreen() {
  return (
    <SafeAreaView className="flex-1 bg-background p-4">
      <Text className="text-primary text-4xl font-inter font-bold">Dashboard</Text>
      <Text className="text-text font-poppins mt-2">Welcome to Real Estate Manager</Text>
    </SafeAreaView>
  );
}
