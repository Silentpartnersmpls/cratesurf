/* touch3: hold several fingers, or tap once, on a virtual touchscreen.
 *
 * The browse-mode launcher in bin/touch-launcher.js fires on a three-finger hold
 * (or Ctrl+Alt+B). The keyboard half can be driven with hid-inject.js, but
 * hid-inject speaks HID reports and cannot declare a multi-touch digitizer, and
 * Node has no ioctl, so this is C: one uinput device, N contacts, held for a
 * while, removed again.
 *
 *   touch3 hold [hold_ms] [fingers]   defaults: 2000 ms, 3 fingers
 *   touch3 tap <x> <y> [hold_ms]      80 ms by default, landscape screen coords
 *
 * With a tap, x and y are the numbers the screenshots are in, so no rotation
 * maths in the caller. Under that there is one, because weston treats this device
 * as portrait and rotates it: measured on the panel, display_x = (max_y - y) *
 * 1280/max_y and display_y = x * 800/max_x. The inverse below turns a screen
 * position into the device values that land there.
 *
 * The device is a DIRECT touchscreen, so libinput treats it as a finger and not
 * as a pointer, and it declares MT slots so simultaneous contacts are real
 * separate contacts rather than one moving one.
 */
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_FINGERS 10
#define PANEL 2048
#define WIDE 1280
#define TALL 800

static int fd = -1;

static void emit(int type, int code, int value) {
  struct input_event ev;
  memset(&ev, 0, sizeof(ev));
  ev.type = type;
  ev.code = code;
  ev.value = value;
  if (write(fd, &ev, sizeof(ev)) < 0)
    perror("write");
}

static void sync_now(void) {
  emit(EV_SYN, SYN_REPORT, 0);
}

int main(int argc, char** argv) {
  // "hold" is the documented verb for a multi-finger press; drop it before the
  // numbers are read. Without this it was parsed as the hold time (0 ms) and the
  // finger count as 10, which is why the gesture never fired from this tool.
  if (argc > 1 && strcmp(argv[1], "hold") == 0) {
    argc -= 1;
    argv += 1;
  }
  int tap = argc > 1 && strcmp(argv[1], "tap") == 0;
  int hold_ms;
  int fingers;
  int tap_x = WIDE / 2;
  int tap_y = TALL / 2;
  int max_x = PANEL - 1;
  int max_y = PANEL - 1;

  if (tap) {
    if (argc < 4) {
      fprintf(stderr, "usage: %s tap <x> <y> [hold_ms]\n", argv[0]);
      return 2;
    }
    tap_x = atoi(argv[2]);
    tap_y = atoi(argv[3]);
    hold_ms = argc > 4 ? atoi(argv[4]) : 80;
    fingers = 1;
    max_x = WIDE - 1;
    max_y = TALL - 1;
  } else {
    hold_ms = argc > 1 ? atoi(argv[1]) : 2000;
    fingers = argc > 2 ? atoi(argv[2]) : 3;
  }
  if (fingers < 1) fingers = 1;
  if (fingers > MAX_FINGERS) fingers = MAX_FINGERS;

  fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
  if (fd < 0) {
    perror("/dev/uinput");
    return 1;
  }

  ioctl(fd, UI_SET_EVBIT, EV_SYN);
  ioctl(fd, UI_SET_EVBIT, EV_KEY);
  ioctl(fd, UI_SET_EVBIT, EV_ABS);
  ioctl(fd, UI_SET_KEYBIT, BTN_TOUCH);
  ioctl(fd, UI_SET_KEYBIT, BTN_TOOL_FINGER);
  ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_DIRECT);

  int codes[] = {ABS_X, ABS_Y, ABS_MT_SLOT, ABS_MT_TRACKING_ID,
                 ABS_MT_POSITION_X, ABS_MT_POSITION_Y};
  for (unsigned i = 0; i < sizeof(codes) / sizeof(codes[0]); ++i)
    ioctl(fd, UI_SET_ABSBIT, codes[i]);

  struct uinput_user_dev dev;
  memset(&dev, 0, sizeof(dev));
  snprintf(dev.name, sizeof(dev.name), "touch3 multi");
  dev.id.bustype = BUS_VIRTUAL;
  dev.id.vendor = 0x1209;
  dev.id.product = 0x0003;
  dev.absmin[ABS_X] = 0;              dev.absmax[ABS_X] = max_x;
  dev.absmin[ABS_Y] = 0;              dev.absmax[ABS_Y] = max_y;
  dev.absmin[ABS_MT_POSITION_X] = 0;  dev.absmax[ABS_MT_POSITION_X] = max_x;
  dev.absmin[ABS_MT_POSITION_Y] = 0;  dev.absmax[ABS_MT_POSITION_Y] = max_y;
  dev.absmin[ABS_MT_SLOT] = 0;        dev.absmax[ABS_MT_SLOT] = MAX_FINGERS - 1;

  if (write(fd, &dev, sizeof(dev)) < 0 || ioctl(fd, UI_DEV_CREATE) < 0) {
    perror("uinput setup");
    close(fd);
    return 1;
  }

  usleep(400000); // let libinput/weston pick the device up before the contacts

  int dev_tap_x = tap_x;
  int dev_tap_y = tap_y;
  if (tap) {
    dev_tap_x = (int)((double)tap_y * (double)max_x / (double)max_y + 0.5);
    dev_tap_y = max_y - (int)((double)tap_x * (double)max_y / (double)max_x + 0.5);
  }

  for (int i = 0; i < fingers; ++i) {
    int x, y;
    if (tap) {
      x = dev_tap_x;
      y = dev_tap_y;
    } else if (fingers == 2) {
      x = (i ? 3 : 1) * max_x / 4;
      y = max_y / 2;
    } else if (fingers == 3) {
      /* Bunched, the way a real hand lands on a 7" panel: the contacts sit about
       * 90 panel units apart, not a quarter of the screen. That is under the 200
       * the launcher used to demand, and testing with a neat wide row is exactly
       * how a spread requirement passed every synthetic test and then never fired
       * for the one hand it was written for. */
      x = max_x / 2 + (i == 0 ? -60 : (i == 1 ? 60 : 0));
      y = max_y / 2 + (i == 2 ? 70 : 0);
    } else {
      /* Four corners, which is what a deliberate claw looks like. */
      x = (i % 2 ? 3 : 1) * max_x / 4;
      y = (i < 2 ? 1 : 3) * max_y / 4 + (i >= 4 ? (i - 3) * 30 : 0);
    }
    emit(EV_ABS, ABS_MT_SLOT, i);
    emit(EV_ABS, ABS_MT_TRACKING_ID, 700 + i);
    emit(EV_ABS, ABS_MT_POSITION_X, x);
    emit(EV_ABS, ABS_MT_POSITION_Y, y);
    sync_now();
  }
  emit(EV_KEY, BTN_TOUCH, 1);
  sync_now();
  if (tap)
    printf("tapped screen %d,%d (device %d,%d) for %d ms\n",
           tap_x, tap_y, dev_tap_x, dev_tap_y, hold_ms);
  else
    printf("%d fingers down, holding %d ms\n", fingers, hold_ms);
  fflush(stdout);

  usleep((useconds_t)hold_ms * 1000);

  for (int i = 0; i < fingers; ++i) {
    emit(EV_ABS, ABS_MT_SLOT, i);
    emit(EV_ABS, ABS_MT_TRACKING_ID, -1);
    sync_now();
  }
  emit(EV_KEY, BTN_TOUCH, 0);
  sync_now();
  usleep(150000);

  ioctl(fd, UI_DEV_DESTROY);
  close(fd);
  printf("released\n");
  return 0;
}
