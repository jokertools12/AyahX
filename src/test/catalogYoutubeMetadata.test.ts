import {describe,it,expect,vi} from 'vitest';
import {youtubeReference,youtubeIframePreview,checkYoutubeOembed} from '../../server/services/catalogYoutubeMetadata';
describe('YouTube metadata boundary',()=>{
  it('only accepts official references and builds IFrame with ms listening coordinates',()=>{
    const ref='https://www.youtube.com/watch?v=abcdefghijk';
    expect(youtubeReference(ref)).toEqual({videoId:'abcdefghijk',playlistId:null});
    expect(youtubeIframePreview(ref,90123,25000)).toMatchObject({start_ms:90123,iframe_url:'https://www.youtube.com/embed/abcdefghijk?enablejsapi=1&start=90&end=116',render_status:'needs_licensed_file'});
    for(const bad of ['https://youtube.com.evil/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://user:pass@youtube.com/watch?v=abcdefghijk','https://googlevideo.com/videoplayback','blob:https://youtube.com/a'])expect(youtubeReference(bad)).toBeNull();
  });
  it('requests only oEmbed once, omits HTML, does not retry quota failures',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({provider_name:'YouTube',title:'Chapter',author_name:'Channel',html:'<script>bad</script>'})));
    const result=await checkYoutubeOembed({videoId:'abcdefghijk',playlistId:null},fetcher);
    expect(result).toMatchObject({status:'available',channel_title:'Channel',rights_status:'unknown'});expect(result.html).toBeUndefined();
    expect(String(fetcher.mock.calls[0][0])).toContain('https://www.youtube.com/oembed?');expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response('quota',{status:429,headers:{'Retry-After':'120'}}));expect(await checkYoutubeOembed({videoId:'abcdefghijk',playlistId:null},fetcher)).toMatchObject({status:'YOUTUBE_OEMBED_HTTP_429',retry_after:'120'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
