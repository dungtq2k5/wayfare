import { BackHandler } from 'react-native';

/**
 * While a sheet is open, Android's back closes it and goes no further; once it is closed (the
 * listener removed), back is the router's again.
 */
export function closeOnBack(onClose: () => void): () => void {
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    onClose();
    return true;
  });
  return () => subscription.remove();
}
