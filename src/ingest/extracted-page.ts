export interface ExtractedPage {
  title: string;
  incidentDate: Date | undefined;
  publishDate: Date;
  sections: { title: string; content: string }[];
  content: string;
}
