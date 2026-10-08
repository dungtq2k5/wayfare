import type { AreaResponseDto } from '@wayfare/api-client';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { areaIcon } from './categories';

/** The areas to choose from, over the map: an icon, a name and a subtitle, with a check on the current one. */
export function AreaSheet({
  areas,
  currentId,
  onChoose,
  onClose,
}: {
  areas: readonly AreaResponseDto[];
  currentId: string | null;
  onChoose: (areaId: string) => void;
  onClose: () => void;
}) {
  const { t, tFamily } = useTourist();
  return (
    <View className="absolute inset-0 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.close')}
        onPress={onClose}
        className="absolute inset-0 bg-overlay/50"
      />
      <View className="max-h-full gap-3 rounded-t-2xl bg-card p-4 elevation-3">
        <Text accessibilityRole="header" className="text-heading text-foreground">
          {t('map.areas.title')}
        </Text>
        <ScrollView contentContainerClassName="gap-2">
          {areas.map((area) => {
            const selected = area.id === currentId;
            return (
              <Pressable
                key={area.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => onChoose(area.id)}
                className={`min-h-12 flex-row items-center gap-3 rounded-lg px-3 py-3 ${
                  selected ? 'border-2 border-primary bg-accent' : 'border border-border bg-card'
                }`}
              >
                <View className="rounded-lg bg-accent p-2">
                  <Icon icon={areaIcon(area.code)} size={24} color="accent-foreground" />
                </View>
                <View className="flex-1">
                  <Text className="text-body-strong text-foreground">
                    {tFamily('area', area.code, area.code)}
                  </Text>
                  <Text className="text-caption text-muted-foreground">
                    {tFamily('area', `${area.code}.subtitle`, tFamily('area', 'generic.subtitle'))}
                  </Text>
                </View>
                <Icon
                  icon={selected ? CheckCircle2 : Circle}
                  size={24}
                  color={selected ? 'primary' : 'muted-foreground'}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
