/* Fixed trusted file operations. No shell, plugins, model code, or archive extraction. */
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdint.h>
#include <inttypes.h>
#include <signal.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
typedef CC_SHA256_CTX Hash;
#define hash_init CC_SHA256_Init
#define hash_update CC_SHA256_Update
#define hash_final CC_SHA256_Final
#define MT(s) ((int64_t)(s).st_mtimespec.tv_sec*1000000000+(s).st_mtimespec.tv_nsec)
#define CT(s) ((int64_t)(s).st_ctimespec.tv_sec*1000000000+(s).st_ctimespec.tv_nsec)
#else
#include <openssl/sha.h>
typedef SHA256_CTX Hash;
#define hash_init SHA256_Init
#define hash_update SHA256_Update
#define hash_final SHA256_Final
#define MT(s) ((int64_t)(s).st_mtim.tv_sec*1000000000+(s).st_mtim.tv_nsec)
#define CT(s) ((int64_t)(s).st_ctim.tv_sec*1000000000+(s).st_ctim.tv_nsec)
#endif
#define MAXFILE (100LL*1024*1024)
static struct {int dir,fd;char name[256];} owned[2];static int owned_count=0;
static void cleanup(void) {
  for(int i=0;i<owned_count;i++) {struct stat a,b;
    if(!fstat(owned[i].fd,&a)&&!fstatat(owned[i].dir,owned[i].name,&b,AT_SYMLINK_NOFOLLOW)&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino) unlinkat(owned[i].dir,owned[i].name,0);
  }
}
static void fail(const char *code) {cleanup();fprintf(stderr,"%s\n",code);exit(2);}
static void interrupted(int sig) {(void)sig;cleanup();write(STDERR_FILENO,"SAFE_FILES_FAILED\n",18);_exit(2);}
static void track(int dir,int fd,const char *name) {if(owned_count>=2||strlen(name)>255) fail("SAFE_FILES_FAILED");owned[owned_count].dir=dup(dir);owned[owned_count].fd=dup(fd);strcpy(owned[owned_count].name,name);owned_count++;}
static int same(struct stat a,struct stat b) {return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_size==b.st_size&&MT(a)==MT(b)&&CT(a)==CT(b);}
static void path_ok(const char *path) {
  if(!*path||strlen(path)>1024||*path=='/') fail("UNSAFE_PATH");
  char *copy=strdup(path),*save=NULL; if(!copy) fail("SAFE_FILES_FAILED");
  if(strstr(path,"//")) fail("UNSAFE_PATH");
  for(char *p=strtok_r(copy,"/",&save);p;p=strtok_r(NULL,"/",&save)) {
    if(!strcmp(p,".")||!strcmp(p,"..")||strlen(p)>255) fail("UNSAFE_PATH");
    for(unsigned char *c=(unsigned char*)p;*c;c++) if(*c<32||*c==127||*c==':'||*c=='\\') fail("UNSAFE_PATH");
  }
  free(copy);
}
/* Walk from '/' or an already-authorized fd, refusing every symlink component. */
static int directory(int base,const char *path) {
  int fd=dup(base);char *copy=strdup(path),*save=NULL;if(fd<0||!copy) fail("SAFE_FILES_FAILED");
  for(char *p=strtok_r(copy,"/",&save);p;p=strtok_r(NULL,"/",&save)) {
    if(!strcmp(p,".")||!strcmp(p,"..")) fail("UNSAFE_PATH");
    int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);
    if(next<0) fail("UNSAFE_PATH");fd=next;
  }
  free(copy);return fd;
}
static int absolute_dir(const char *path) {if(*path!='/') fail("UNSAFE_PATH");int slash=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);int fd=directory(slash,path);close(slash);return fd;}
static int parent(int root,const char *path,char **name) {
  path_ok(path);char *copy=strdup(path),*slash=strrchr(copy,'/');int fd;
  if(slash) {*slash=0;fd=directory(root,copy);*name=strdup(slash+1);} else {fd=dup(root);*name=strdup(copy);}
  free(copy);if(!*name||fd<0) fail("SAFE_FILES_FAILED");return fd;
}
static int absolute_parent(const char *path,char **name) {
  char *copy=strdup(path),*slash=strrchr(copy,'/');if(!slash||slash==copy) fail("UNSAFE_PATH");
  *slash=0;int fd=absolute_dir(copy);*name=strdup(slash+1);path_ok(*name);free(copy);return fd;
}
static struct stat regular(int fd) {struct stat s;if(fstat(fd,&s)||!S_ISREG(s.st_mode)||s.st_nlink!=1) fail("UNSAFE_PATH");if(s.st_size<0||s.st_size>MAXFILE) fail("WORKSPACE_LIMIT");return s;}
static int input_file(int dir,const char *name) {int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd<0) fail("UNSAFE_PATH");regular(fd);return fd;}
static void write_all(int fd,const void *buffer,size_t size) {
  const unsigned char *p=buffer;while(size) {ssize_t n=write(fd,p,size);if(n<0&&errno==EINTR) continue;if(n<=0) fail("SAFE_FILES_FAILED");p+=n;size-=n;}
}
static void digest_copy(int in,int out,int64_t limit,char hex[65]) {
  unsigned char buffer[65536],digest[32];Hash hash;hash_init(&hash);int64_t size=0;if(lseek(in,0,SEEK_SET)<0) fail("SAFE_FILES_FAILED");
  while(1) {ssize_t n=read(in,buffer,sizeof(buffer));if(n<0&&errno==EINTR) continue;if(n<0) fail("SAFE_FILES_FAILED");if(!n) break;
    size+=n;if(size>limit) fail("WORKSPACE_LIMIT");hash_update(&hash,buffer,(unsigned int)n);if(out>=0) write_all(out,buffer,(size_t)n);
  }
  hash_final(digest,&hash);for(int i=0;i<32;i++) snprintf(hex+2*i,3,"%02x",digest[i]);hex[64]=0;
}
static void unchanged(int fd,struct stat old) {struct stat now=regular(fd);if(!same(now,old)) fail("SOURCE_CHANGED");}
static void fingerprint(struct stat s,const char *hash) {printf("{\"sha256\":\"%s\",\"size\":%jd,\"device\":\"%ju\",\"inode\":\"%ju\",\"mtimeNs\":\"%" PRId64 "\"}",hash,(intmax_t)s.st_size,(uintmax_t)s.st_dev,(uintmax_t)s.st_ino,MT(s));}
static void json_string(const char *s) {
  putchar('"');for(const unsigned char *p=(const unsigned char*)s;*p;p++) {if(*p=='"'||*p=='\\') {putchar('\\');putchar(*p);} else if(*p<32) printf("\\u%04x",*p);else putchar(*p);}putchar('"');
}
static int64_t number(const char *s) {char *end;errno=0;int64_t n=strtoll(s,&end,10);if(errno||*end||n<0) fail("INVALID_INPUT");return n;}
static int entries=0,workspace_scan=0,visited=0;static int64_t total=0,maxentries,maxfile,maxtotal;
static int excluded_name(const char *name) {
  const char *names[]={".git","node_modules","dist","build",".next",".cache",".ssh",".aws",".azure",".config",".kube",".npm",".gnupg",".codex",".attachments",NULL};
  for(int i=0;names[i];i++)if(!strcasecmp(name,names[i]))return 1;
  if(!strncasecmp(name,".env",4))return 1;
  const char *keys[]={"id_rsa","id_ed25519","credentials","token",NULL};
  for(int i=0;keys[i];i++){size_t n=strlen(keys[i]);if(!strncasecmp(name,keys[i],n)&&(!name[n]||name[n]=='.'))return 1;}
  const char *ext=strrchr(name,'.');return ext&&(!strcasecmp(ext,".pem")||!strcasecmp(ext,".key")||!strcasecmp(ext,".p12")||!strcasecmp(ext,".pfx"));
}
static void scan(int dir,const char *prefix) {
  struct stat before;if(fstat(dir,&before)) fail("SAFE_FILES_FAILED");
  DIR *stream=fdopendir(dup(dir));if(!stream) fail("SAFE_FILES_FAILED");struct dirent *entry;
  while((entry=readdir(stream))) {
    if(!strcmp(entry->d_name,".")||!strcmp(entry->d_name,"..")) continue;
    char path[1025];if(snprintf(path,sizeof(path),"%s%s%s",prefix,*prefix?"/":"",entry->d_name)>1024) fail("UNSAFE_PATH");path_ok(path);
    if(workspace_scan&&++visited>20000)fail("WORKSPACE_LIMIT");
    if(workspace_scan&&excluded_name(entry->d_name)){printf("{\"excluded\":");json_string(path);printf("}\n");continue;}
    if(++entries>maxentries) fail("WORKSPACE_LIMIT");
    struct stat s;if(fstatat(dir,entry->d_name,&s,AT_SYMLINK_NOFOLLOW)) fail("SOURCE_CHANGED");
    if(s.st_dev!=before.st_dev || (!S_ISDIR(s.st_mode)&&!S_ISREG(s.st_mode)) || (S_ISREG(s.st_mode)&&s.st_nlink!=1)) fail("UNSAFE_PATH");
    if(S_ISREG(s.st_mode) && (s.st_size>maxfile || (total+=s.st_size)>maxtotal)) fail("WORKSPACE_LIMIT");
    if(workspace_scan)printf("{\"entry\":");printf("{\"relativePath\":");json_string(path);
    if(S_ISDIR(s.st_mode)) {
      printf(",\"kind\":\"directory\",\"size\":0,\"sha256\":null}");if(workspace_scan)printf(",\"fingerprint\":null}");printf("\n");
      int child=openat(dir,entry->d_name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0) fail("UNSAFE_PATH");scan(child,path);close(child);
    } else {
      int fd=input_file(dir,entry->d_name);struct stat version=regular(fd);char hash[65];digest_copy(fd,-1,maxfile,hash);unchanged(fd,version);
      struct stat named;if(fstatat(dir,entry->d_name,&named,AT_SYMLINK_NOFOLLOW)||!same(version,named)) fail("SOURCE_CHANGED");close(fd);
      printf(",\"kind\":\"file\",\"size\":%jd,\"sha256\":\"%s\"}",(intmax_t)version.st_size,hash);
      if(workspace_scan){printf(",\"fingerprint\":");fingerprint(version,hash);printf("}");}printf("\n");
    }
  }
  closedir(stream);struct stat after;if(fstat(dir,&after)||MT(before)!=MT(after)||CT(before)!=CT(after)) fail("SOURCE_CHANGED");
}
static void check_expected(int fd,const char *expected) {
  struct stat s=regular(fd);char actual[65],text[256];digest_copy(fd,-1,MAXFILE,actual);unchanged(fd,s);
  snprintf(text,sizeof(text),"%s:%jd:%ju:%ju:%" PRId64,actual,(intmax_t)s.st_size,(uintmax_t)s.st_dev,(uintmax_t)s.st_ino,MT(s));
  if(strcmp(text,expected)) fail("FILE_CONFLICT");
}
static void stable_parent(int root,const char *path,int dir,const char *rootpath,struct stat root_before) {
  char *name;int again=parent(root,path,&name);free(name);struct stat a,b,now;
  int currentroot=absolute_dir(rootpath);
  if(fstat(again,&a)||fstat(dir,&b)||a.st_dev!=b.st_dev||a.st_ino!=b.st_ino||fstat(currentroot,&now)||now.st_dev!=root_before.st_dev||now.st_ino!=root_before.st_ino) fail("SOURCE_CHANGED");close(again);close(currentroot);
}
int main(int argc,char **argv) {
  umask(077);signal(SIGTERM,interrupted);signal(SIGINT,interrupted);if(argc<5) fail("INVALID_INPUT");
  int root=absolute_dir(argv[2]);struct stat roots;if(fstat(root,&roots)) fail("SAFE_FILES_FAILED");
  if((uintmax_t)roots.st_dev!=(uintmax_t)number(argv[3])||(uintmax_t)roots.st_ino!=(uintmax_t)number(argv[4])) fail("SOURCE_CHANGED");
  if(!strcmp(argv[1],"scan")||!strcmp(argv[1],"workspace-scan")) {if(argc!=8) fail("INVALID_INPUT");workspace_scan=!strcmp(argv[1],"workspace-scan");maxentries=number(argv[5]);maxfile=number(argv[6]);maxtotal=number(argv[7]);scan(root,"");int again=absolute_dir(argv[2]);struct stat now;if(fstat(again,&now)||now.st_dev!=roots.st_dev||now.st_ino!=roots.st_ino)fail("SOURCE_CHANGED");return 0;}
  if(argc<6) fail("INVALID_INPUT");char *name;int dir=parent(root,argv[5],&name);
  if(!strcmp(argv[1],"copy")) {
    if(argc!=8) fail("INVALID_INPUT");int in=input_file(dir,name);struct stat s=regular(in);if(s.st_size>number(argv[7])) fail("WORKSPACE_LIMIT");
    char *target;int destination=absolute_parent(argv[6],&target),out=openat(destination,target,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(out<0) fail("SAFE_FILES_FAILED");
    track(destination,out,target);
    char hash[65];digest_copy(in,out,number(argv[7]),hash);unchanged(in,s);struct stat named;
    if(fstatat(dir,name,&named,AT_SYMLINK_NOFOLLOW)||!same(named,s)) {unlinkat(destination,target,0);fail("SOURCE_CHANGED");}
    stable_parent(root,argv[5],dir,argv[2],roots);if(fsync(out)) fail("SAFE_FILES_FAILED");owned_count=0;fingerprint(s,hash);return 0;
  }
  if(!strcmp(argv[1],"read")) {
    if(argc!=8) fail("INVALID_INPUT");int in=input_file(dir,name);struct stat s=regular(in);int64_t offset=number(argv[6]),max=number(argv[7]);
    if(max>65536||offset>s.st_size) fail("INVALID_RANGE");unsigned char buffer[65536];ssize_t n=pread(in,buffer,(size_t)max,(off_t)offset);if(n<0) fail("SAFE_FILES_FAILED");
    unchanged(in,s);stable_parent(root,argv[5],dir,argv[2],roots);write_all(STDOUT_FILENO,buffer,(size_t)n);return 0;
  }
  int deleting=!strcmp(argv[1],"delete");if(!deleting&&strcmp(argv[1],"replace")) fail("INVALID_INPUT");
  if(argc!=11) fail("INVALID_INPUT");path_ok(argv[9]);path_ok(argv[10]);
  int previous=-1;struct stat target;
  if(!strcmp(argv[7],"absent")) {if(!fstatat(dir,name,&target,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT) fail("FILE_CONFLICT");if(deleting) fail("INVALID_INPUT");}
  else {previous=input_file(dir,name);check_expected(previous,argv[7]);target=regular(previous);}
  int backups=absolute_dir(argv[8]);char backuphash[65];
  if(previous>=0) {int out=openat(backups,argv[9],O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(out<0) fail("SAFE_FILES_FAILED");track(backups,out,argv[9]);digest_copy(previous,out,MAXFILE,backuphash);unchanged(previous,target);if(fsync(out)) fail("SAFE_FILES_FAILED");close(out);}
  int incoming=-1;struct stat replacement;char incominghash[65];
  if(!deleting) {
    char *source;int sourcedir=absolute_parent(argv[6],&source),in=input_file(sourcedir,source);struct stat input=regular(in);
    incoming=openat(dir,argv[10],O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);if(incoming<0) fail("SAFE_FILES_FAILED");
    track(dir,incoming,argv[10]);
    digest_copy(in,incoming,MAXFILE,incominghash);unchanged(in,input);if(fsync(incoming)||fstat(incoming,&replacement)) fail("SAFE_FILES_FAILED");close(incoming);close(in);close(sourcedir);free(source);
  }
  stable_parent(root,argv[5],dir,argv[2],roots);
  if(previous>=0) {check_expected(previous,argv[7]);struct stat now;if(fstatat(dir,name,&now,AT_SYMLINK_NOFOLLOW)||!same(target,now)) fail("FILE_CONFLICT");}
  else if(!fstatat(dir,name,&target,AT_SYMLINK_NOFOLLOW)||errno!=ENOENT) fail("FILE_CONFLICT");
  if(deleting) {if(unlinkat(dir,name,0)) fail("SAFE_FILES_FAILED");owned_count=0;printf("{\"backupKey\":\"%s\"}",argv[9]);}
  else {
    if(previous<0) {if(linkat(dir,argv[10],dir,name,0)) fail(errno==EEXIST?"FILE_CONFLICT":"SAFE_FILES_FAILED");if(unlinkat(dir,argv[10],0)) fail("SAFE_FILES_FAILED");}
    else if(renameat(dir,argv[10],dir,name)) fail("SAFE_FILES_FAILED");
    owned_count=0;printf("{\"backupKey\":");if(previous>=0) json_string(argv[9]);else printf("null");printf(",\"version\":");fingerprint(replacement,incominghash);printf("}");
  }
  if(fsync(dir)) fail("SAFE_FILES_FAILED");return 0;
}
