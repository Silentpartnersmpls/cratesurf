# Pinned Node runtime for both MPC generations.
#
# Sourced by deploy/install-node.sh and installer/make-payload.sh so a payload and
# a deploy cannot disagree about what they ship. Keep the SHAs in sync with the
# upstream nodejs.org release; an upstream re-release must be a deliberate change,
# not something that silently changes what runs on a device.
NODE_VERSION=v22.23.4
NODE_ARCH_ARMHF=armv7l
NODE_ARCH_ARM64=arm64
NODE_SHA256_ARMHF=c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437
NODE_SHA256_ARM64=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b
