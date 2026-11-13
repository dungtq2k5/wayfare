import { Text, View } from 'react-native';
import type { OpeningHoursRowInput } from '@wayfare/core';
import { useTourist } from '../i18n/use-tourist';
import { hoursLines } from './hours-lines';

/** The week with today highlighted, special dates as their own rows, or "Hours not listed". */
export function HoursBlock({ rows }: { rows: readonly OpeningHoursRowInput[] }) {
  const { t, tFamily } = useTourist();
  if (rows.length === 0) {
    return <Text className="text-body text-muted-foreground">{t('place.hours.notListed')}</Text>;
  }
  const { week, specials } = hoursLines(rows, Date.now());
  const ranges = (line: { ranges: readonly string[]; closed: boolean }) =>
    line.closed ? t('place.hours.closedDay') : line.ranges.join(', ');
  return (
    <View className="gap-1">
      {week.map((line) => (
        <View
          key={line.weekday}
          className={`flex-row flex-wrap justify-between gap-x-3 rounded-md px-2 py-1 ${line.today ? 'bg-accent' : ''}`}
        >
          <Text
            className={`text-body ${line.today ? 'text-accent-foreground' : 'text-foreground'}`}
          >
            {tFamily('weekday', String(line.weekday))}
          </Text>
          <Text
            className={`text-body ${line.today ? 'text-accent-foreground' : 'text-muted-foreground'}`}
          >
            {ranges(line)}
          </Text>
        </View>
      ))}
      {specials.map((line) => (
        <View key={line.date} className="flex-row flex-wrap justify-between gap-x-3 px-2 py-1">
          <Text className="text-body text-foreground">{line.date}</Text>
          <Text className="text-body text-muted-foreground">{ranges(line)}</Text>
        </View>
      ))}
    </View>
  );
}
