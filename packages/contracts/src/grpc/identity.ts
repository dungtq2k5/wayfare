// identity's three generated files as one namespace. They share the package constants, which
// the explicit export below disambiguates.
export * from '../generated/wayfare/identity/auth.pb';
export * from '../generated/wayfare/identity/device.pb';
export * from '../generated/wayfare/identity/user.pb';
export {
  protobufPackage,
  WAYFARE_IDENTITY_PACKAGE_NAME,
} from '../generated/wayfare/identity/device.pb';
