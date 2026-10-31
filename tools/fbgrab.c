/* fbgrab: capture the framebuffer as PPM, once or as a short sequence.
 *
 * Why this exists: Chromium's frame clock said the GPU path was 60 fps while
 * the panel was showing whole black frames and half-drawn frames. A frame time
 * is not a frame. This reads /dev/fb0, which on the MPC is the KMS scanout
 * framebuffer, so the file contains what the panel was actually fed.
 *
 *   fbgrab out.ppm                 one frame
 *   fbgrab prefix 20 50           20 frames, one every 50 ms, prefix-000.ppm ...
 *
 * The output is binary PPM (P6), which ImageMagick, ffmpeg and Python's PIL all
 * read without a conversion step. It handles 16, 24 and 32 bpp with the channel
 * offsets the driver reports; 8 bpp indexed modes are refused rather than
 * guessed at.
 */
#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

static uint8_t* fb = NULL;
static size_t fb_len = 0;
static struct fb_fix_screeninfo finfo;
static struct fb_var_screeninfo vinfo;

static int channel(uint32_t pixel, const struct fb_bitfield* field) {
  if (!field->length) return 0;
  uint32_t v = (pixel >> field->offset) & ((1u << field->length) - 1u);
  /* Stretch any field width to 8 bits, so RGB565 and RGB888 both land in range. */
  return (int)((v * 255u) / ((1u << field->length) - 1u));
}

static int write_ppm(const char* path, const uint8_t* base) {
  FILE* out = fopen(path, "wb");
  if (!out) {
    perror(path);
    return -1;
  }
  fprintf(out, "P6\n%u %u\n255\n", vinfo.xres, vinfo.yres);
  const int bpp = vinfo.bits_per_pixel;
  for (unsigned y = 0; y < vinfo.yres; ++y) {
    const uint8_t* row = base + (size_t)y * finfo.line_length;
    for (unsigned x = 0; x < vinfo.xres; ++x) {
      uint8_t rgb[3];
      if (bpp == 32) {
        uint32_t p;
        memcpy(&p, row + (size_t)x * 4, 4);
        rgb[0] = channel(p, &vinfo.red);
        rgb[1] = channel(p, &vinfo.green);
        rgb[2] = channel(p, &vinfo.blue);
      } else if (bpp == 24) {
        /* No bitfields in the 24 bpp mode; the KMS formats used here are BGR. */
        rgb[0] = row[(size_t)x * 3 + 2];
        rgb[1] = row[(size_t)x * 3 + 1];
        rgb[2] = row[(size_t)x * 3 + 0];
      } else if (bpp == 16) {
        uint16_t p;
        memcpy(&p, row + (size_t)x * 2, 2);
        rgb[0] = channel(p, &vinfo.red);
        rgb[1] = channel(p, &vinfo.green);
        rgb[2] = channel(p, &vinfo.blue);
      } else {
        fclose(out);
        fprintf(stderr, "unsupported %d bpp\n", bpp);
        return -1;
      }
      fwrite(rgb, 1, 3, out);
    }
  }
  if (fclose(out) != 0) {
    perror(path);
    return -1;
  }
  return 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <out.ppm>\n", argv[0]);
    fprintf(stderr, "       %s <prefix> <count> <interval_ms>\n", argv[0]);
    return 2;
  }

  int fd = open("/dev/fb0", O_RDONLY);
  if (fd < 0) {
    perror("/dev/fb0");
    return 1;
  }
  if (ioctl(fd, FBIOGET_FSCREENINFO, &finfo) < 0 ||
      ioctl(fd, FBIOGET_VSCREENINFO, &vinfo) < 0) {
    perror("FBIOGET");
    close(fd);
    return 1;
  }
  if (vinfo.bits_per_pixel != 16 && vinfo.bits_per_pixel != 24 &&
      vinfo.bits_per_pixel != 32) {
    fprintf(stderr, "unsupported %u bpp\n", vinfo.bits_per_pixel);
    close(fd);
    return 1;
  }
  fb_len = (size_t)finfo.line_length * vinfo.yres;
  fb = mmap(NULL, fb_len, PROT_READ, MAP_SHARED, fd, 0);
  if (fb == MAP_FAILED) {
    perror("mmap /dev/fb0");
    close(fd);
    return 1;
  }

  int count = 1;
  int interval_ms = 0;
  if (argc >= 4) {
    count = atoi(argv[2]);
    interval_ms = atoi(argv[3]);
  }
  if (count < 1) count = 1;
  if (interval_ms < 0) interval_ms = 0;

  for (int i = 0; i < count; ++i) {
    char path[4096];
    if (count == 1)
      snprintf(path, sizeof(path), "%s", argv[1]);
    else
      snprintf(path, sizeof(path), "%s-%03d.ppm", argv[1], i);
    if (write_ppm(path, fb) != 0) {
      munmap(fb, fb_len);
      close(fd);
      return 1;
    }
    if (i + 1 < count && interval_ms > 0)
      usleep((useconds_t)interval_ms * 1000);
  }

  munmap(fb, fb_len);
  close(fd);
  printf("captured %d frame(s), %ux%u %ubpp, stride %u\n", count, vinfo.xres,
         vinfo.yres, vinfo.bits_per_pixel, finfo.line_length);
  return 0;
}
