import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppThemeProvider } from "@/src/theme";
import HomeScreen from "@/src/screens/HomeScreen";
import HandoverScreen from "@/src/screens/HandoverScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Handover" component={HandoverScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
