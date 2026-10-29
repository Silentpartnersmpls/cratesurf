/* grabcheck: ask the kernel who is holding each input device.
 *
 * Why this exists: browse mode wants a way to be launched from the MPC's own
 * screen (a corner hold on the glass). That only works if the MPC application
 * does not hold the touchscreen exclusively. EVIOCGRAB is exclusive per device,
 * and evdev returns EBUSY when someone else already grabbed it, so this answers
 * the question directly instead of guessing.
 *
 *   grabcheck              per-device report, grab state included
 *   grabcheck watch <secs> read /dev/input/event0 and print raw events
 *
 * Nothing is written; any grab taken for the test is released immediately.
 */
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

static int bit_set(const unsigned long* bits, int code) {
  return (bits[code / (8 * sizeof(unsigned long))] >> (code % (8 * sizeof(unsigned long)))) & 1UL;
}

static void abs_range(int fd, int code, const char* label) {
  struct input_absinfo info;
  if (ioctl(fd, EVIOCGABS(code), &info) == 0)
    printf("      %-12s %d..%d\n", label, info.minimum, info.maximum);
}

/* Long names for the handful of codes a touchscreen or hotkey actually uses. */
static const char* code_name(int type, int code) {
  static char buf[32];
  if (type == EV_KEY) {
    switch (code) {
      case BTN_TOUCH: return "BTN_TOUCH";
      case BTN_TOOL_FINGER: return "BTN_TOOL_FINGER";
      case KEY_LEFTCTRL: return "LEFTCTRL";
      case KEY_LEFTALT: return "LEFTALT";
      case KEY_B: return "B";
      default: break;
    }
  } else if (type == EV_ABS) {
    switch (code) {
      case ABS_X: return "ABS_X";
      case ABS_Y: return "ABS_Y";
      case ABS_MT_SLOT: return "MT_SLOT";
      case ABS_MT_TRACKING_ID: return "MT_TRACKING_ID";
      case ABS_MT_POSITION_X: return "MT_POSITION_X";
      case ABS_MT_POSITION_Y: return "MT_POSITION_Y";
      case ABS_MT_PRESSURE: return "MT_PRESSURE";
      default: break;
    }
  }
  snprintf(buf, sizeof(buf), "type%d/code%d", type, code);
  return buf;
}

int main(int argc, char** argv) {
  char path[64];
  unsigned long keys[(KEY_MAX / 8) / sizeof(unsigned long) + 2];
  unsigned long abs[(ABS_MAX / 8) / sizeof(unsigned long) + 2];

  for (int i = 0; i < 16; ++i) {
    snprintf(path, sizeof(path), "/dev/input/event%d", i);
    int fd = open(path, O_RDONLY | O_NONBLOCK);
    if (fd < 0)
      continue;

    char name[128] = {0};
    ioctl(fd, EVIOCGNAME(sizeof(name)), name);
    memset(keys, 0, sizeof(keys));
    memset(abs, 0, sizeof(abs));
    ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(keys)), keys);
    ioctl(fd, EVIOCGBIT(EV_ABS, sizeof(abs)), abs);

    int touch = bit_set(keys, BTN_TOUCH);
    int grab = ioctl(fd, EVIOCGRAB, 1);
    int grab_errno = errno;
    if (grab == 0)
      ioctl(fd, EVIOCGRAB, 0);

    printf("%s \"%s\"\n", path, name);
    printf("      touchscreen: %s   exclusive grab: %s\n", touch ? "yes" : "no",
           grab == 0 ? "free (we could take it)"
                     : (grab_errno == EBUSY ? "HELD by another process (EBUSY)"
                                            : strerror(grab_errno)));
    if (touch || bit_set(abs, ABS_X)) {
      abs_range(fd, ABS_X, "ABS_X");
      abs_range(fd, ABS_Y, "ABS_Y");
      abs_range(fd, ABS_MT_SLOT, "MT_SLOT");
      abs_range(fd, ABS_MT_POSITION_X, "MT_POS_X");
      abs_range(fd, ABS_MT_POSITION_Y, "MT_POS_Y");
    }
    close(fd);
  }

  if (argc >= 3 && strcmp(argv[1], "watch") == 0) {
    const char* dev = argc >= 4 ? argv[3] : "/dev/input/event0";
    int secs = atoi(argv[2]);
    int fd = open(dev, O_RDONLY);
    if (fd < 0) {
      perror(dev);
      return 1;
    }
    printf("\nwatching %s for %ds, touch the glass now\n", dev, secs);
    fflush(stdout);
    struct input_event ev;
    time_t end = time(NULL) + secs;
    while (time(NULL) < end) {
      ssize_t n = read(fd, &ev, sizeof(ev));
      if (n == (ssize_t)sizeof(ev))
        printf("  %-14s %-18s %d\n", ev.type == EV_SYN ? "SYN" : (ev.type == EV_KEY ? "KEY" : (ev.type == EV_ABS ? "ABS" : "?")),
               code_name(ev.type, ev.code), ev.value);
    }
    close(fd);
  }
  return 0;
}
