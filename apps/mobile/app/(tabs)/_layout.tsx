import { Tabs } from 'expo-router';
import { Compass, Heart, Map as MapIcon, Settings } from 'lucide-react-native';
import { Text, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { space } from '@wayfare/design-tokens/tokens';
import { TAB_BAR_HEIGHT, TAB_BAR_ITEM_HEIGHT } from '../../src/ui/layout';
import { useTourist } from '../../src/i18n/use-tourist';
import { useTheme } from '../../src/theme/appearance';

/**
 * The four tabs, always opening on Map. Their labels are the one text that stops growing, at 1.3×
 * (conventions §12.5): a tab bar cannot wrap.
 */
export default function TabsLayout() {
  const { t } = useTourist();
  const { colors } = useTheme();
  const label =
    (text: string) =>
    ({ focused }: { focused: boolean }) => (
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        className={`text-caption ${focused ? 'text-primary' : 'text-muted-foreground'}`}
      >
        {text}
      </Text>
    );
  /** The icon sits on a jade pill when its tab is the one in front. */
  const icon =
    (Glyph: typeof MapIcon) =>
    ({ focused, color }: { focused: boolean; color: ColorValue }) => (
      <View className={`items-center rounded-full px-5 py-1 ${focused ? 'bg-accent' : ''}`}>
        <Glyph size={24} color={color} />
      </View>
    );
  return (
    <Tabs
      initialRouteName="map"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors['accent-foreground'],
        tabBarInactiveTintColor: colors['muted-foreground'],
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: TAB_BAR_HEIGHT,
          paddingTop: space[2],
          paddingBottom: space[2],
        },
        tabBarItemStyle: { height: TAB_BAR_ITEM_HEIGHT },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: t('nav.map'),
          tabBarLabel: label(t('nav.map')),
          tabBarIcon: icon(MapIcon),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('nav.explore'),
          tabBarLabel: label(t('nav.explore')),
          tabBarIcon: icon(Compass),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: t('nav.favorites'),
          tabBarLabel: label(t('nav.favorites')),
          tabBarIcon: icon(Heart),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarLabel: label(t('nav.settings')),
          tabBarIcon: icon(Settings),
        }}
      />
    </Tabs>
  );
}
