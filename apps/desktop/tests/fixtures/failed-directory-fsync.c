#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
static int injected_fsync(int fd);
#define fsync injected_fsync
#include "../../native/safe-files-posix.c"
#undef fsync
static int injected_fsync(int fd) {struct stat s;if(!fstat(fd,&s)&&S_ISDIR(s.st_mode)){errno=EIO;return -1;}return fsync(fd);}
